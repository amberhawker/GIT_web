import {
	ALLOWED_IMAGE_MIME_TYPES,
	MAX_UPLOAD_FILES,
	MAX_UPLOAD_FILE_BYTES,
	MAX_UPLOAD_TOTAL_BYTES,
	formatBytes,
	mimeForImageFilename,
} from '../../lib/admin/upload-rules.mjs';

type ImgRef = { path: string; alt?: string };

type EventData = {
	title: string;
	imgs: ImgRef[];
	description?: string;
	date?: string;
	featured: boolean;
};

type ExecData = {
	role: string;
	name: string;
	img: string;
	imgs?: ImgRef[];
	degree: string;
	description: string;
};

type CommitInfo = { sha?: string; htmlUrl?: string; message?: string; source?: 'github' | 'local' };
type ListItem = { id: string; title: string; meta?: string };
type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };
type ApiInit = RequestInit & { onUploadProgress?: (percent: number) => void };

const SESSION_ENDED = 'Your admin session has ended. Reload the page and log in again.';
let sessionEndedPrompted = false;

function failure(status: number, error: string | undefined): { ok: false; error: string } {
	if (status !== 401) return { ok: false, error: error ?? `Request failed (${status})` };
	if (!sessionEndedPrompted) {
		sessionEndedPrompted = true;
		if (confirm('Your admin session has ended. Reload to log in again? Unsaved changes will be lost.')) {
			window.location.reload();
		}
	}
	return { ok: false, error: SESSION_ENDED };
}

async function api<T>(path: string, init?: ApiInit): Promise<ApiResult<T>> {
	const { onUploadProgress, ...rest } = init ?? {};
	const headers = { 'Content-Type': 'application/json', ...(rest.headers ?? {}) };

	// XHR so we can report real upload progress for media saves.
	if (onUploadProgress && typeof rest.body === 'string') {
		return new Promise((resolve) => {
			const xhr = new XMLHttpRequest();
			xhr.open(rest.method ?? 'GET', path);
			for (const [key, value] of Object.entries(headers)) {
				if (typeof value === 'string') xhr.setRequestHeader(key, value);
			}
			xhr.upload.onprogress = (event) => {
				if (!event.lengthComputable || event.total <= 0) return;
				onUploadProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
			};
			xhr.onload = () => {
				let body: T & { error?: string };
				try {
					body = JSON.parse(xhr.responseText || '{}') as T & { error?: string };
				} catch {
					body = {} as T & { error?: string };
				}
				if (xhr.status < 200 || xhr.status >= 300) {
					resolve(failure(xhr.status, body.error));
					return;
				}
				onUploadProgress(100);
				resolve({ ok: true, data: body as T });
			};
			xhr.onerror = () => resolve({ ok: false, error: 'Network error' });
			xhr.send(rest.body as string);
		});
	}

	const res = await fetch(path, { ...rest, headers });
	const body = (await res.json().catch(() => ({}))) as T & { error?: string };
	if (!res.ok) return failure(res.status, body.error);
	return { ok: true, data: body as T };
}

function fileToBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = String(reader.result ?? '');
			resolve(result.includes(',') ? result.split(',')[1] : result);
		};
		reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
		reader.readAsDataURL(file);
	});
}

/** Per-file checks mirroring the server rules, so bad files fail before upload. */
function checkUploadFiles(files: File[]): string | null {
	for (const file of files) {
		const mime = mimeForImageFilename(file.name);
		if (!mime || (file.type && !ALLOWED_IMAGE_MIME_TYPES.includes(file.type))) {
			return `${file.name} isn't a supported image. Use PNG, JPEG, WebP, or GIF.`;
		}
		if (file.size > MAX_UPLOAD_FILE_BYTES) {
			return `${file.name} is ${formatBytes(file.size)}; the limit is ${formatBytes(MAX_UPLOAD_FILE_BYTES)} per image.`;
		}
	}
	return null;
}

/** Per-file checks plus the per-save count and total-size limits. */
function checkUploadBatch(input: HTMLInputElement): string | null {
	const files = Array.from(input.files ?? []);
	const fileError = checkUploadFiles(files);
	if (fileError) return fileError;
	if (files.length > MAX_UPLOAD_FILES) {
		return `Choose at most ${MAX_UPLOAD_FILES} images per save, then add the rest in another save.`;
	}
	const total = files.reduce((sum, file) => sum + file.size, 0);
	if (total > MAX_UPLOAD_TOTAL_BYTES) {
		return `Selected images total ${formatBytes(total)}; the limit is ${formatBytes(MAX_UPLOAD_TOTAL_BYTES)} per save. Save fewer images, then add the rest in another save.`;
	}
	return null;
}

/** Split files into groups that each fit the per-request count and size limits. */
function uploadBatches(files: File[]): File[][] {
	const batches: File[][] = [];
	let current: File[] = [];
	let currentBytes = 0;
	for (const file of files) {
		if (current.length >= MAX_UPLOAD_FILES || currentBytes + file.size > MAX_UPLOAD_TOTAL_BYTES) {
			batches.push(current);
			current = [];
			currentBytes = 0;
		}
		current.push(file);
		currentBytes += file.size;
	}
	if (current.length) batches.push(current);
	return batches;
}

async function encodeUploads(list: File[]) {
	const files = [];
	for (const file of list) {
		files.push({ filename: file.name, contentBase64: await fileToBase64(file) });
	}
	return files;
}

function collectUploads(input: HTMLInputElement) {
	return encodeUploads(Array.from(input.files ?? []));
}

function setStatus(el: HTMLElement | null, message: string, kind: 'info' | 'ok' | 'err' = 'info') {
	if (!el) return;
	el.textContent = message;
	el.classList.toggle('is-ok', kind === 'ok');
	el.classList.toggle('is-err', kind === 'err');
}

function commitNote(commit?: CommitInfo, source?: 'github' | 'local'): string {
	const from = source ?? commit?.source;
	if (from === 'local' || commit?.sha?.startsWith('local-')) {
		return 'Saved locally (dev). Files written under src/; commit when ready.';
	}
	if (!commit?.sha) return 'Saved.';
	return `Saved (${commit.sha.slice(0, 7)}). Site updates after Cloudflare rebuild.`;
}

function setProgress(el: HTMLElement | null, percent: number | null) {
	if (!el) return;
	const bar = el.querySelector('.admin-progress-bar') as HTMLElement | null;
	if (percent === null) {
		el.classList.add('hidden');
		el.setAttribute('aria-valuenow', '0');
		if (bar) bar.style.width = '0%';
		return;
	}
	const value = Math.max(0, Math.min(100, percent));
	el.classList.remove('hidden');
	el.setAttribute('aria-valuenow', String(value));
	if (bar) bar.style.width = `${value}%`;
}

function qs<T extends HTMLElement>(root: ParentNode, selector: string): T {
	const el = root.querySelector(selector);
	if (!el) throw new Error(`Missing element: ${selector}`);
	return el as T;
}

function parseImgs(text: string): ImgRef[] | string {
	const imgs: ImgRef[] = [];
	for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
		const [path, ...altParts] = line.split('|');
		if (!path?.trim()) return 'Each image line needs a path';
		imgs.push({ path: path.trim(), alt: altParts.join('|').trim() || undefined });
	}
	return imgs;
}

function formatImgs(imgs: ImgRef[] | undefined): string {
	return (imgs ?? []).map((img) => (img.alt ? `${img.path} | ${img.alt}` : img.path)).join('\n');
}

function renderItemList(
	container: HTMLElement,
	items: ListItem[],
	selectedId: string | null,
	onSelect: (id: string) => void,
	emptyMessage = 'Nothing here yet.'
) {
	container.innerHTML = '';
	if (items.length === 0) {
		const empty = document.createElement('p');
		empty.className = 'admin-item-empty';
		empty.textContent = emptyMessage;
		container.appendChild(empty);
		return;
	}

	for (const item of items) {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = `admin-item${item.id === selectedId ? ' is-selected' : ''}`;
		btn.setAttribute('role', 'option');
		btn.setAttribute('aria-selected', String(item.id === selectedId));

		const title = document.createElement('span');
		title.className = 'admin-item-title';
		title.textContent = item.title;
		btn.appendChild(title);

		if (item.meta) {
			const meta = document.createElement('span');
			meta.className = 'admin-item-meta';
			meta.textContent = item.meta;
			btn.appendChild(meta);
		}

		btn.addEventListener('click', () => onSelect(item.id));
		container.appendChild(btn);
	}
}

function clearListSelection(container: HTMLElement) {
	container.querySelectorAll('.admin-item').forEach((el) => {
		el.classList.remove('is-selected');
		el.setAttribute('aria-selected', 'false');
	});
}

function switchTab(root: HTMLElement, tab: string) {
	root.querySelectorAll('[data-tab]').forEach((btn) => {
		const active = btn.getAttribute('data-tab') === tab;
		btn.classList.toggle('tab-active', active);
		btn.setAttribute('aria-selected', String(active));
	});
	root.querySelectorAll('[data-panel]').forEach((panel) => {
		(panel as HTMLElement).classList.toggle('hidden', panel.getAttribute('data-panel') !== tab);
	});
}

async function initEvents(root: HTMLElement) {
	const list = qs<HTMLElement>(root, '#events-list');
	const form = qs<HTMLFormElement>(root, '#event-form');
	const status = qs<HTMLElement>(root, '#events-status');
	const idInput = qs<HTMLInputElement>(form, '[name="id"]');
	const titleInput = qs<HTMLInputElement>(form, '[name="title"]');
	const dateInput = qs<HTMLInputElement>(form, '[name="date"]');
	const descInput = qs<HTMLTextAreaElement>(form, '[name="description"]');
	const featuredInput = qs<HTMLInputElement>(form, '[name="featured"]');
	const imgsInput = qs<HTMLTextAreaElement>(form, '[name="imgs"]');
	const filesInput = qs<HTMLInputElement>(form, '[name="files"]');
	const progress = root.querySelector('#events-progress') as HTMLElement | null;
	const newBtn = qs<HTMLButtonElement>(root, '#event-new');
	const deleteBtn = qs<HTMLButtonElement>(root, '#event-delete');

	let selectedId: string | null = null;
	let cache: Record<string, EventData> = {};
	let items: ListItem[] = [];

	function fillForm(id: string | null, data?: EventData) {
		selectedId = id;
		idInput.value = id ?? '';
		idInput.readOnly = Boolean(id);
		titleInput.value = data?.title ?? '';
		dateInput.value = data?.date ?? '';
		descInput.value = data?.description ?? '';
		featuredInput.checked = Boolean(data?.featured);
		imgsInput.value = formatImgs(data?.imgs);
		filesInput.value = '';
		deleteBtn.disabled = !id;
		setProgress(progress, null);
	}

	function selectItem(id: string) {
		fillForm(id, cache[id]);
		renderItemList(list, items, selectedId, selectItem);
	}

	async function refresh() {
		setStatus(status, 'Loading events…');
		const res = await api<{ events: { id: string; data: EventData }[] }>('/api/admin/events');
		if (!res.ok) {
			items = [];
			cache = {};
			selectedId = null;
			fillForm(null);
			renderItemList(list, [], null, selectItem, 'Could not load events.');
			setStatus(status, res.error, 'err');
			return;
		}

		cache = Object.fromEntries(res.data.events.map((e) => [e.id, e.data]));
		items = res.data.events.map((e) => ({
			id: e.id,
			title: e.data.title || e.id,
			meta: e.id,
		}));

		const next = selectedId && cache[selectedId] ? selectedId : res.data.events[0]?.id ?? null;
		fillForm(next, next ? cache[next] : undefined);
		renderItemList(list, items, selectedId, selectItem);
		setStatus(status, `${res.data.events.length} events`);
	}

	newBtn.addEventListener('click', () => {
		clearListSelection(list);
		fillForm(null, { title: '', imgs: [], description: '', date: '', featured: false });
		idInput.focus();
		setStatus(status, 'Creating a new event');
	});

	deleteBtn.addEventListener('click', async () => {
		if (!selectedId || !confirm(`Delete event “${selectedId}”?`)) return;
		setStatus(status, 'Deleting…');
		const res = await api<{ commit?: CommitInfo }>(
			`/api/admin/events/${encodeURIComponent(selectedId)}`,
			{ method: 'DELETE' }
		);
		if (!res.ok) return setStatus(status, res.error, 'err');
		selectedId = null;
		setStatus(status, commitNote(res.data.commit), 'ok');
		await refresh();
	});

	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		const id = idInput.value.trim();
		if (!id) return setStatus(status, 'id is required', 'err');

		const imgs = parseImgs(imgsInput.value);
		if (typeof imgs === 'string') return setStatus(status, imgs, 'err');

		const data: EventData = {
			title: titleInput.value.trim(),
			date: dateInput.value,
			description: descInput.value,
			featured: featuredInput.checked,
			imgs,
		};
		const uploadError = checkUploadBatch(filesInput);
		if (uploadError) return setStatus(status, uploadError, 'err');
		const files = await collectUploads(filesInput);
		const isNew = !selectedId;
		const trackUpload = files.length > 0;

		setStatus(status, trackUpload ? 'Uploading…' : 'Saving…');
		setProgress(progress, trackUpload ? 0 : null);
		const onUploadProgress = trackUpload
			? (percent: number) => {
					setProgress(progress, percent);
					setStatus(status, `Uploading… ${percent}%`);
				}
			: undefined;

		const res = isNew
			? await api<{ commit?: CommitInfo; source?: 'github' | 'local' }>('/api/admin/events', {
					method: 'POST',
					body: JSON.stringify({ id, data, files }),
					onUploadProgress,
				})
			: await api<{ commit?: CommitInfo; source?: 'github' | 'local' }>(
					`/api/admin/events/${encodeURIComponent(id)}`,
					{
						method: 'PUT',
						body: JSON.stringify({ data, files }),
						onUploadProgress,
					}
				);

		if (!res.ok) {
			setProgress(progress, null);
			return setStatus(status, res.error, 'err');
		}
		selectedId = id;
		setProgress(progress, trackUpload ? 100 : null);
		setStatus(status, commitNote(res.data.commit, res.data.source), 'ok');
		await refresh();
		setProgress(progress, null);
	});

	await refresh();
}

async function initExecs(root: HTMLElement) {
	const list = qs<HTMLElement>(root, '#execs-list');
	const form = qs<HTMLFormElement>(root, '#exec-form');
	const status = qs<HTMLElement>(root, '#execs-status');
	const idInput = qs<HTMLInputElement>(form, '[name="id"]');
	const roleInput = qs<HTMLInputElement>(form, '[name="role"]');
	const nameInput = qs<HTMLInputElement>(form, '[name="name"]');
	const degreeInput = qs<HTMLInputElement>(form, '[name="degree"]');
	const descInput = qs<HTMLTextAreaElement>(form, '[name="description"]');
	const imgInput = qs<HTMLInputElement>(form, '[name="img"]');
	const imgsInput = qs<HTMLTextAreaElement>(form, '[name="imgs"]');
	const filesInput = qs<HTMLInputElement>(form, '[name="files"]');
	const progress = root.querySelector('#execs-progress') as HTMLElement | null;
	const newBtn = qs<HTMLButtonElement>(root, '#exec-new');
	const deleteBtn = qs<HTMLButtonElement>(root, '#exec-delete');

	let selectedId: string | null = null;
	let cache: Record<string, ExecData> = {};
	let items: ListItem[] = [];

	function fillForm(id: string | null, data?: ExecData) {
		selectedId = id;
		idInput.value = id ?? '';
		idInput.readOnly = Boolean(id);
		roleInput.value = data?.role ?? '';
		nameInput.value = data?.name ?? '';
		degreeInput.value = data?.degree ?? '';
		descInput.value = data?.description ?? '';
		imgInput.value = data?.img ?? '';
		imgsInput.value = formatImgs(data?.imgs);
		filesInput.value = '';
		deleteBtn.disabled = !id;
		setProgress(progress, null);
	}

	function selectItem(id: string) {
		fillForm(id, cache[id]);
		renderItemList(list, items, selectedId, selectItem);
	}

	async function refresh() {
		setStatus(status, 'Loading execs…');
		const res = await api<{ execs: { id: string; data: ExecData }[] }>('/api/admin/execs');
		if (!res.ok) {
			items = [];
			cache = {};
			selectedId = null;
			fillForm(null);
			renderItemList(list, [], null, selectItem, 'Could not load team members.');
			setStatus(status, res.error, 'err');
			return;
		}

		cache = Object.fromEntries(res.data.execs.map((e) => [e.id, e.data]));
		items = res.data.execs.map((e) => ({
			id: e.id,
			title: e.data.name || e.id,
			meta: e.data.role,
		}));

		const next = selectedId && cache[selectedId] ? selectedId : res.data.execs[0]?.id ?? null;
		fillForm(next, next ? cache[next] : undefined);
		renderItemList(list, items, selectedId, selectItem);
		setStatus(status, `${res.data.execs.length} execs`);
	}

	newBtn.addEventListener('click', () => {
		clearListSelection(list);
		fillForm(null, {
			role: '',
			name: '',
			img: '/assets/execs/placeholder.jpg',
			imgs: [],
			degree: '',
			description: '',
		});
		idInput.focus();
		setStatus(status, 'Creating a new exec');
	});

	deleteBtn.addEventListener('click', async () => {
		if (!selectedId || !confirm(`Delete exec “${selectedId}”?`)) return;
		setStatus(status, 'Deleting…');
		const res = await api<{ commit?: CommitInfo }>(
			`/api/admin/execs/${encodeURIComponent(selectedId)}`,
			{ method: 'DELETE' }
		);
		if (!res.ok) return setStatus(status, res.error, 'err');
		selectedId = null;
		setStatus(status, commitNote(res.data.commit), 'ok');
		await refresh();
	});

	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		const id = idInput.value.trim();
		if (!id) return setStatus(status, 'id is required', 'err');

		const imgs = parseImgs(imgsInput.value);
		if (typeof imgs === 'string') return setStatus(status, imgs, 'err');

		const data: ExecData = {
			role: roleInput.value.trim(),
			name: nameInput.value.trim(),
			degree: degreeInput.value,
			description: descInput.value,
			img: imgInput.value.trim() || '/assets/execs/placeholder.jpg',
			imgs,
		};
		const uploadError = checkUploadBatch(filesInput);
		if (uploadError) return setStatus(status, uploadError, 'err');
		const files = await collectUploads(filesInput);
		const isNew = !selectedId;
		const trackUpload = files.length > 0;

		setStatus(status, trackUpload ? 'Uploading…' : 'Saving…');
		setProgress(progress, trackUpload ? 0 : null);
		const onUploadProgress = trackUpload
			? (percent: number) => {
					setProgress(progress, percent);
					setStatus(status, `Uploading… ${percent}%`);
				}
			: undefined;

		const res = isNew
			? await api<{ commit?: CommitInfo; source?: 'github' | 'local' }>('/api/admin/execs', {
					method: 'POST',
					body: JSON.stringify({ id, data, files }),
					onUploadProgress,
				})
			: await api<{ commit?: CommitInfo; source?: 'github' | 'local' }>(
					`/api/admin/execs/${encodeURIComponent(id)}`,
					{
						method: 'PUT',
						body: JSON.stringify({ data, files }),
						onUploadProgress,
					}
				);

		if (!res.ok) {
			setProgress(progress, null);
			return setStatus(status, res.error, 'err');
		}
		selectedId = id;
		setProgress(progress, trackUpload ? 100 : null);
		setStatus(status, commitNote(res.data.commit, res.data.source), 'ok');
		await refresh();
		setProgress(progress, null);
	});

	await refresh();
}

async function initGallery(root: HTMLElement) {
	const grid = qs<HTMLElement>(root, '#gallery-grid');
	const form = qs<HTMLFormElement>(root, '#gallery-form');
	const status = qs<HTMLElement>(root, '#gallery-status');
	const progress = root.querySelector('#gallery-progress') as HTMLElement | null;
	const filesInput = qs<HTMLInputElement>(form, '[name="files"]');

	async function refresh() {
		setStatus(status, 'Loading gallery…');
		const res = await api<{ images: { name: string }[] }>('/api/admin/gallery');
		if (!res.ok) return setStatus(status, res.error, 'err');

		grid.replaceChildren(
			...res.data.images.map((image) => {
				const card = document.createElement('article');
				card.className = 'admin-gallery-card';
				card.innerHTML = `
					<div class="admin-gallery-thumb">
						<img src="/api/admin/gallery/${encodeURIComponent(image.name)}" alt="" loading="lazy" />
					</div>
					<div class="admin-gallery-meta">
						<p class="admin-gallery-name"></p>
						<button type="button" class="admin-gallery-delete">Delete</button>
					</div>
				`;
				const nameEl = card.querySelector('.admin-gallery-name') as HTMLElement;
				const thumb = card.querySelector('.admin-gallery-thumb') as HTMLElement;
				const img = card.querySelector('img') as HTMLImageElement;
				nameEl.textContent = image.name;
				nameEl.title = image.name;
				img.alt = image.name;
				img.addEventListener('error', () => {
					thumb.classList.add('is-missing');
					img.replaceWith(Object.assign(document.createElement('span'), { textContent: image.name }));
				});
				card.querySelector('button')?.addEventListener('click', async () => {
					if (!confirm(`Delete gallery image “${image.name}”?`)) return;
					setStatus(status, 'Deleting…');
					const del = await api<{ commit?: CommitInfo }>(
						`/api/admin/gallery/${encodeURIComponent(image.name)}`,
						{ method: 'DELETE' }
					);
					if (!del.ok) return setStatus(status, del.error, 'err');
					setStatus(status, commitNote(del.data.commit, del.data.source), 'ok');
					await refresh();
				});
				return card;
			})
		);

		setStatus(status, `${res.data.images.length} images`);
	}

	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		const selected = Array.from(filesInput.files ?? []);
		if (selected.length === 0) return setStatus(status, 'Choose at least one image', 'err');
		const uploadError = checkUploadFiles(selected);
		if (uploadError) return setStatus(status, uploadError, 'err');

		const batches = uploadBatches(selected);
		const label = (i: number, percent: number) =>
			batches.length > 1 ? `Uploading part ${i + 1} of ${batches.length}… ${percent}%` : `Uploading… ${percent}%`;
		let last: { commit?: CommitInfo; source?: 'github' | 'local' } | undefined;

		setStatus(status, label(0, 0));
		setProgress(progress, 0);
		for (const [i, batch] of batches.entries()) {
			const files = await encodeUploads(batch);
			const res = await api<{ commit?: CommitInfo; source?: 'github' | 'local' }>('/api/admin/gallery', {
				method: 'POST',
				body: JSON.stringify({ files }),
				onUploadProgress: (percent) => {
					setProgress(progress, Math.round(((i + percent / 100) / batches.length) * 100));
					setStatus(status, label(i, percent));
				},
			});
			if (!res.ok) {
				setProgress(progress, null);
				const done = batches.slice(0, i).reduce((sum, b) => sum + b.length, 0);
				if (done > 0) await refresh();
				return setStatus(status, done > 0 ? `${done} of ${selected.length} images saved. ${res.error}` : res.error, 'err');
			}
			last = res.data;
		}
		filesInput.value = '';
		setProgress(progress, 100);
		await refresh();
		setStatus(status, commitNote(last?.commit, last?.source), 'ok');
		setProgress(progress, null);
	});

	await refresh();
}

export function initAdminDashboard(root: HTMLElement) {
	root.querySelectorAll('[data-tab]').forEach((btn) => {
		btn.addEventListener('click', () => {
			const tab = btn.getAttribute('data-tab');
			if (tab) switchTab(root, tab);
		});
	});

	void initEvents(root);
	void initExecs(root);
	void initGallery(root);
}

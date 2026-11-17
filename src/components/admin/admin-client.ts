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
					resolve({ ok: false, error: body.error ?? `Request failed (${xhr.status})` });
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
	if (!res.ok) return { ok: false, error: body.error ?? `Request failed (${res.status})` };
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

async function collectUploads(input: HTMLInputElement) {
	const files = [];
	for (const file of Array.from(input.files ?? [])) {
		files.push({ filename: file.name, contentBase64: await fileToBase64(file) });
	}
	return files;
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
		const files = await collectUploads(filesInput);
		if (files.length === 0) return setStatus(status, 'Choose at least one image', 'err');

		setStatus(status, 'Uploading… 0%');
		setProgress(progress, 0);
		const res = await api<{ commit?: CommitInfo; source?: 'github' | 'local' }>('/api/admin/gallery', {
			method: 'POST',
			body: JSON.stringify({ files }),
			onUploadProgress: (percent) => {
				setProgress(progress, percent);
				setStatus(status, `Uploading… ${percent}%`);
			},
		});
		if (!res.ok) {
			setProgress(progress, null);
			return setStatus(status, res.error, 'err');
		}
		filesInput.value = '';
		setProgress(progress, 100);
		setStatus(status, commitNote(res.data.commit, res.data.source), 'ok');
		await refresh();
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

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

type CommitInfo = { sha?: string; htmlUrl?: string; message?: string };
type ListItem = { id: string; title: string; meta?: string };
type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };
type UploadFile = { filename: string; contentBase64: string };

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif)$/i;

async function api<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
	const res = await fetch(path, {
		...init,
		headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
	});
	const body = (await res.json().catch(() => ({}))) as T & { error?: string };
	if (!res.ok) return { ok: false, error: body.error ?? `Request failed (${res.status})` };
	return { ok: true, data: body as T };
}

function sanitizeImageFilename(name: string): string {
	const base = name.split(/[/\\]/).pop()?.trim() ?? '';
	const extMatch = base.match(IMAGE_EXT_RE);
	if (!extMatch) return '';

	let ext = extMatch[0].toLowerCase();
	if (ext === '.jpeg') ext = '.jpg';

	const stem = base
		.slice(0, -extMatch[0].length)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);

	return `${stem || 'image'}${ext}`;
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

async function collectUploads(input: HTMLInputElement): Promise<UploadFile[] | string> {
	const files: UploadFile[] = [];
	const taken = new Set<string>();

	for (const file of Array.from(input.files ?? [])) {
		if (file.size > MAX_UPLOAD_BYTES) {
			return `${file.name} is too large (max 8MB)`;
		}
		if (file.type && !ALLOWED_IMAGE_TYPES.has(file.type)) {
			return `${file.name}: use PNG, JPEG, WEBP, or GIF`;
		}

		const sanitized = sanitizeImageFilename(file.name);
		if (!sanitized) {
			return `invalid filename: ${file.name}`;
		}

		const ext = sanitized.match(IMAGE_EXT_RE)?.[0] ?? '.png';
		const stem = sanitized.slice(0, -ext.length);
		let filename = sanitized;
		let n = 2;
		while (taken.has(filename.toLowerCase())) {
			filename = `${stem}-${n}${ext}`;
			n += 1;
		}
		taken.add(filename.toLowerCase());

		files.push({ filename, contentBase64: await fileToBase64(file) });
	}
	return files;
}

function setStatus(el: HTMLElement | null, message: string, kind: 'info' | 'ok' | 'err' = 'info') {
	if (!el) return;
	el.textContent = message;
	el.classList.toggle('is-ok', kind === 'ok');
	el.classList.toggle('is-err', kind === 'err');
}

function commitNote(commit?: CommitInfo): string {
	if (!commit?.sha) return 'Saved.';
	return `Saved (${commit.sha.slice(0, 7)}). Site updates after Cloudflare rebuild.`;
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
		if (typeof files === 'string') return setStatus(status, files, 'err');
		const isNew = !selectedId;

		setStatus(status, 'Saving…');
		const res = isNew
			? await api<{ commit?: CommitInfo }>('/api/admin/events', {
					method: 'POST',
					body: JSON.stringify({ id, data, files }),
				})
			: await api<{ commit?: CommitInfo }>(`/api/admin/events/${encodeURIComponent(id)}`, {
					method: 'PUT',
					body: JSON.stringify({ data, files }),
				});

		if (!res.ok) return setStatus(status, res.error, 'err');
		selectedId = id;
		setStatus(status, commitNote(res.data.commit), 'ok');
		await refresh();
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
		if (typeof files === 'string') return setStatus(status, files, 'err');
		const isNew = !selectedId;

		setStatus(status, 'Saving…');
		const res = isNew
			? await api<{ commit?: CommitInfo }>('/api/admin/execs', {
					method: 'POST',
					body: JSON.stringify({ id, data, files }),
				})
			: await api<{ commit?: CommitInfo }>(`/api/admin/execs/${encodeURIComponent(id)}`, {
					method: 'PUT',
					body: JSON.stringify({ data, files }),
				});

		if (!res.ok) return setStatus(status, res.error, 'err');
		selectedId = id;
		setStatus(status, commitNote(res.data.commit), 'ok');
		await refresh();
	});

	await refresh();
}

async function initGallery(root: HTMLElement) {
	const grid = qs<HTMLElement>(root, '#gallery-grid');
	const form = qs<HTMLFormElement>(root, '#gallery-form');
	const status = qs<HTMLElement>(root, '#gallery-status');
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
					setStatus(status, commitNote(del.data.commit), 'ok');
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
		if (typeof files === 'string') return setStatus(status, files, 'err');
		if (files.length === 0) return setStatus(status, 'Choose at least one image', 'err');

		setStatus(status, 'Uploading…');
		const res = await api<{ commit?: CommitInfo }>('/api/admin/gallery', {
			method: 'POST',
			body: JSON.stringify({ files }),
		});
		if (!res.ok) return setStatus(status, res.error, 'err');
		filesInput.value = '';
		setStatus(status, commitNote(res.data.commit), 'ok');
		await refresh();
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

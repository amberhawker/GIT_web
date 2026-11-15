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

type GalleryImage = { name: string; path: string };

type CommitInfo = { sha?: string; htmlUrl?: string; message?: string };

async function api<T>(
	path: string,
	init?: RequestInit
): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
	const res = await fetch(path, {
		...init,
		headers: {
			'Content-Type': 'application/json',
			...(init?.headers ?? {}),
		},
	});
	const body = (await res.json().catch(() => ({}))) as T & { error?: string };
	if (!res.ok) {
		return { ok: false, error: body.error ?? `Request failed (${res.status})`, status: res.status };
	}
	return { ok: true, data: body as T };
}

function fileToBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = String(reader.result ?? '');
			const base64 = result.includes(',') ? result.split(',')[1] : result;
			resolve(base64);
		};
		reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
		reader.readAsDataURL(file);
	});
}

function setStatus(el: HTMLElement | null, message: string, kind: 'info' | 'ok' | 'err' = 'info') {
	if (!el) return;
	el.textContent = message;
	el.classList.remove('text-success', 'text-error', 'text-base-content/60');
	if (kind === 'ok') el.classList.add('text-success');
	else if (kind === 'err') el.classList.add('text-error');
	else el.classList.add('text-base-content/60');
}

function commitNote(commit?: CommitInfo): string {
	if (!commit?.sha) return 'Saved.';
	const short = commit.sha.slice(0, 7);
	return `Saved (${short}). Site updates after Cloudflare rebuild.`;
}

function qs<T extends HTMLElement>(root: ParentNode, selector: string): T {
	const el = root.querySelector(selector);
	if (!el) throw new Error(`Missing element: ${selector}`);
	return el as T;
}

function switchTab(root: HTMLElement, tab: string) {
	root.querySelectorAll('[data-tab]').forEach((btn) => {
		btn.classList.toggle('tab-active', btn.getAttribute('data-tab') === tab);
	});
	root.querySelectorAll('[data-panel]').forEach((panel) => {
		const match = panel.getAttribute('data-panel') === tab;
		(panel as HTMLElement).classList.toggle('hidden', !match);
	});
}

function parseImgs(text: string): ImgRef[] | string {
	const lines = text
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean);
	const imgs: ImgRef[] = [];
	for (const line of lines) {
		const [path, ...altParts] = line.split('|');
		if (!path?.trim()) return 'Each image line needs a path';
		imgs.push({
			path: path.trim(),
			alt: altParts.join('|').trim() || undefined,
		});
	}
	return imgs;
}

function formatImgs(imgs: ImgRef[] | undefined): string {
	return (imgs ?? []).map((img) => (img.alt ? `${img.path} | ${img.alt}` : img.path)).join('\n');
}

async function initEvents(root: HTMLElement) {
	const list = qs<HTMLSelectElement>(root, '#events-list');
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

	async function refresh() {
		setStatus(status, 'Loading events…');
		const res = await api<{ events: { id: string; data: EventData }[] }>('/api/admin/events');
		if (!res.ok) {
			setStatus(status, res.error, 'err');
			return;
		}
		cache = Object.fromEntries(res.data.events.map((e) => [e.id, e.data]));
		list.innerHTML = '';
		for (const event of res.data.events) {
			const opt = document.createElement('option');
			opt.value = event.id;
			opt.textContent = `${event.data.title} (${event.id})`;
			list.appendChild(opt);
		}
		if (selectedId && cache[selectedId]) {
			list.value = selectedId;
			fillForm(selectedId, cache[selectedId]);
		} else if (res.data.events[0]) {
			list.value = res.data.events[0].id;
			fillForm(res.data.events[0].id, res.data.events[0].data);
		} else {
			fillForm(null);
		}
		setStatus(status, `${res.data.events.length} events`);
	}

	list.addEventListener('change', () => {
		const id = list.value;
		fillForm(id, cache[id]);
	});

	newBtn.addEventListener('click', () => {
		list.selectedIndex = -1;
		fillForm(null, {
			title: '',
			imgs: [],
			description: '',
			date: '',
			featured: false,
		});
		idInput.focus();
		setStatus(status, 'Creating a new event');
	});

	deleteBtn.addEventListener('click', async () => {
		if (!selectedId) return;
		if (!confirm(`Delete event “${selectedId}”?`)) return;
		setStatus(status, 'Deleting…');
		const res = await api<{ commit?: CommitInfo }>(
			`/api/admin/events/${encodeURIComponent(selectedId)}`,
			{ method: 'DELETE' }
		);
		if (!res.ok) {
			setStatus(status, res.error, 'err');
			return;
		}
		selectedId = null;
		setStatus(status, commitNote(res.data.commit), 'ok');
		await refresh();
	});

	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		const id = idInput.value.trim();
		if (!id) {
			setStatus(status, 'id is required', 'err');
			return;
		}
		const imgs = parseImgs(imgsInput.value);
		if (typeof imgs === 'string') {
			setStatus(status, imgs, 'err');
			return;
		}

		const data: EventData = {
			title: titleInput.value.trim(),
			date: dateInput.value,
			description: descInput.value,
			featured: featuredInput.checked,
			imgs,
		};

		const files: { filename: string; contentBase64: string }[] = [];
		for (const file of Array.from(filesInput.files ?? [])) {
			files.push({ filename: file.name, contentBase64: await fileToBase64(file) });
		}

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

		if (!res.ok) {
			setStatus(status, res.error, 'err');
			return;
		}
		selectedId = id;
		setStatus(status, commitNote(res.data.commit), 'ok');
		await refresh();
	});

	await refresh();
}

async function initExecs(root: HTMLElement) {
	const list = qs<HTMLSelectElement>(root, '#execs-list');
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

	async function refresh() {
		setStatus(status, 'Loading execs…');
		const res = await api<{ execs: { id: string; data: ExecData }[] }>('/api/admin/execs');
		if (!res.ok) {
			setStatus(status, res.error, 'err');
			return;
		}
		cache = Object.fromEntries(res.data.execs.map((e) => [e.id, e.data]));
		list.innerHTML = '';
		for (const exec of res.data.execs) {
			const opt = document.createElement('option');
			opt.value = exec.id;
			opt.textContent = `${exec.data.name} — ${exec.data.role}`;
			list.appendChild(opt);
		}
		if (selectedId && cache[selectedId]) {
			list.value = selectedId;
			fillForm(selectedId, cache[selectedId]);
		} else if (res.data.execs[0]) {
			list.value = res.data.execs[0].id;
			fillForm(res.data.execs[0].id, res.data.execs[0].data);
		} else {
			fillForm(null);
		}
		setStatus(status, `${res.data.execs.length} execs`);
	}

	list.addEventListener('change', () => {
		const id = list.value;
		fillForm(id, cache[id]);
	});

	newBtn.addEventListener('click', () => {
		list.selectedIndex = -1;
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
		if (!selectedId) return;
		if (!confirm(`Delete exec “${selectedId}”?`)) return;
		setStatus(status, 'Deleting…');
		const res = await api<{ commit?: CommitInfo }>(
			`/api/admin/execs/${encodeURIComponent(selectedId)}`,
			{ method: 'DELETE' }
		);
		if (!res.ok) {
			setStatus(status, res.error, 'err');
			return;
		}
		selectedId = null;
		setStatus(status, commitNote(res.data.commit), 'ok');
		await refresh();
	});

	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		const id = idInput.value.trim();
		if (!id) {
			setStatus(status, 'id is required', 'err');
			return;
		}
		const imgs = parseImgs(imgsInput.value);
		if (typeof imgs === 'string') {
			setStatus(status, imgs, 'err');
			return;
		}

		const data: ExecData = {
			role: roleInput.value.trim(),
			name: nameInput.value.trim(),
			degree: degreeInput.value,
			description: descInput.value,
			img: imgInput.value.trim() || '/assets/execs/placeholder.jpg',
			imgs,
		};

		const files: { filename: string; contentBase64: string }[] = [];
		for (const file of Array.from(filesInput.files ?? [])) {
			files.push({ filename: file.name, contentBase64: await fileToBase64(file) });
		}

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

		if (!res.ok) {
			setStatus(status, res.error, 'err');
			return;
		}
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
		const res = await api<{ images: GalleryImage[] }>('/api/admin/gallery');
		if (!res.ok) {
			setStatus(status, res.error, 'err');
			return;
		}

		grid.innerHTML = '';
		for (const image of res.data.images) {
			const item = document.createElement('div');
			item.className = 'border border-base-200 rounded-lg p-2 space-y-2';
			item.innerHTML = `
				<div class="aspect-square overflow-hidden rounded bg-base-200 flex items-center justify-center text-xs text-base-content/50">
					<span>${image.name}</span>
				</div>
				<p class="text-xs truncate" title="${image.name}">${image.name}</p>
				<button type="button" class="btn btn-ghost btn-xs text-error" data-delete="${image.name}">Delete</button>
			`;
			grid.appendChild(item);
		}

		grid.querySelectorAll<HTMLButtonElement>('[data-delete]').forEach((btn) => {
			btn.addEventListener('click', async () => {
				const name = btn.dataset.delete;
				if (!name || !confirm(`Delete gallery image “${name}”?`)) return;
				setStatus(status, 'Deleting…');
				const del = await api<{ commit?: CommitInfo }>(
					`/api/admin/gallery/${encodeURIComponent(name)}`,
					{ method: 'DELETE' }
				);
				if (!del.ok) {
					setStatus(status, del.error, 'err');
					return;
				}
				setStatus(status, commitNote(del.data.commit), 'ok');
				await refresh();
			});
		});

		setStatus(status, `${res.data.images.length} images`);
	}

	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		const selected = Array.from(filesInput.files ?? []);
		if (selected.length === 0) {
			setStatus(status, 'Choose at least one image', 'err');
			return;
		}

		const files = [];
		for (const file of selected) {
			files.push({ filename: file.name, contentBase64: await fileToBase64(file) });
		}

		setStatus(status, 'Uploading…');
		const res = await api<{ commit?: CommitInfo }>('/api/admin/gallery', {
			method: 'POST',
			body: JSON.stringify({ files }),
		});
		if (!res.ok) {
			setStatus(status, res.error, 'err');
			return;
		}
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

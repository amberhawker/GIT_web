import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareEventUploads } from '../src/lib/admin/upload-rules.mjs';

test('event uploads leave existing photos alone and publish independent Gallery copies', async () => {
	const existing = { path: '/assets/events/cover.jpg', alt: 'Cover' };
	const data = { imgs: [existing] };
	const files = [
		{ filename: 'photo.jpg', contentBase64: 'AA==' },
		{ filename: 'another.jpg', contentBase64: 'AQ==' },
	];
	const names = { events: ['PHOTO.JPG'], gallery: ['Another.jpg'] };

	const uploads = await prepareEventUploads(data, files, async (folder) => names[folder]);

	assert.deepEqual(uploads, [
		{ path: 'src/assets/events/photo-1.jpg', content: 'AA==', encoding: 'base64' },
		{ path: 'src/assets/events/another.jpg', content: 'AQ==', encoding: 'base64' },
		{ path: 'src/assets/gallery/photo.jpg', content: 'AA==', encoding: 'base64' },
		{ path: 'src/assets/gallery/another-1.jpg', content: 'AQ==', encoding: 'base64' },
	]);
	assert.deepEqual(data.imgs, [existing, { path: '/assets/events/photo-1.jpg' }, { path: '/assets/events/another.jpg' }]);
});

test('saving an event without new uploads does not touch Gallery', async () => {
	const existing = { path: '/assets/events/cover.jpg' };
	const data = { imgs: [existing] };
	const uploads = await prepareEventUploads(data, [], () => assert.fail('No upload directory lookup expected'));

	assert.deepEqual(uploads, []);
	assert.deepEqual(data.imgs, [existing]);
});

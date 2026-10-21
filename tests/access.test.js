import test from 'node:test';
import assert from 'node:assert/strict';
import { teacherArea, teacherAccess, assignmentRoute, publicUrl, teacherUrl } from '../js/cloud/access.js';

test('teacher tools require both the teacher URL and an authorized teacher role', () => {
  for (const path of ['/create/', '/create', '/create/index.html', '/singing/create/']) {
    assert.equal(teacherArea(path), true);
    for (const role of ['owner', 'teacher']) assert.equal(teacherAccess(path, { role }), true);
    for (const principal of [null, { role: 'student' }, { role: 'other' }]) assert.equal(teacherAccess(path, principal), false);
  }
  for (const path of ['/', '/index.html', '/create-fake/', '/games/']) assert.equal(teacherAccess(path, { role: 'teacher' }), false);
});

test('only assignment routes request student sign-in', () => {
  for (const path of ['/assignments', '/assignment/a']) assert.equal(assignmentRoute(path), true);
  assert.equal(assignmentRoute('/play/song/karaoke', { attempt: 'a' }), true);
  for (const path of ['/', '/song/a', '/play/song/karaoke', '/help', '/chant', '/party']) assert.equal(assignmentRoute(path), false);
});

test('shared assignments and bingo cards leave the teacher area and preserve static host paths', () => {
  for (const path of ['/create/', '/create', '/create/index.html', '/']) {
    assert.equal(publicUrl('#/assignment/a', 'https://singing.test', path), 'https://singing.test/#/assignment/a');
    assert.equal(publicUrl('#/card/song/seed', 'https://singing.test', path), 'https://singing.test/#/card/song/seed');
  }
  assert.equal(publicUrl('#/song/a', 'https://example.test', '/singing/'), 'https://example.test/singing/#/song/a');
  assert.equal(publicUrl('#/', 'https://example.test', '/singing/create/'), 'https://example.test/singing/#/');
  assert.equal(teacherUrl('#/studio/a', '/'), '/create/#/studio/a');
  assert.equal(teacherUrl('#/studio/a', '/singing/index.html'), '/singing/create/#/studio/a');
});

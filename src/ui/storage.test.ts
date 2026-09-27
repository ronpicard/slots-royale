import test from 'node:test'
import assert from 'node:assert/strict'
import { loadCamera, saveCamera } from './storage.ts'
import type { CameraView } from '../render/engineApi.ts'

const CAMERA_VIEWS: readonly CameraView[] = ['close', 'wide', 'floor']

/** A minimal Storage backed by a Map: only getItem/setItem/removeItem are needed here. */
function fakeStorage(initial?: Record<string, string>): Storage {
  const map = new Map<string, string>(Object.entries(initial ?? {}))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
  } as unknown as Storage
}

test('loadCamera defaults to the close view', () => {
  assert.equal(loadCamera(null), 'close')
  assert.equal(loadCamera(fakeStorage()), 'close')
})

test('loadCamera keeps a current view and maps the old auto, reels and cabinet views onto close, close and wide', () => {
  assert.equal(loadCamera(fakeStorage({ 'slots-royale.camera': 'close' })), 'close')
  assert.equal(loadCamera(fakeStorage({ 'slots-royale.camera': 'wide' })), 'wide')
  assert.equal(loadCamera(fakeStorage({ 'slots-royale.camera': 'floor' })), 'floor')
  assert.equal(loadCamera(fakeStorage({ 'slots-royale.camera': 'auto' })), 'close')
  assert.equal(loadCamera(fakeStorage({ 'slots-royale.camera': 'reels' })), 'close')
  assert.equal(loadCamera(fakeStorage({ 'slots-royale.camera': 'cabinet' })), 'wide')
})

test('loadCamera falls back to close for an unknown value', () => {
  assert.equal(loadCamera(fakeStorage({ 'slots-royale.camera': 'nonsense' })), 'close')
})

test('saveCamera then loadCamera round-trips every view', () => {
  const storage = fakeStorage()
  for (const view of CAMERA_VIEWS) {
    saveCamera(storage, view)
    assert.equal(loadCamera(storage), view)
  }
})

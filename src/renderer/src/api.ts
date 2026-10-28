import type { PatchwrightApi } from '../../shared/api'
import { createMockApi } from './mock'

declare global {
  interface Window {
    patchwright?: PatchwrightApi
  }
}

/** True when the UI runs in a plain browser (npm run preview:web), with demo data instead of the engine. */
export const demo = !window.patchwright

export const api: PatchwrightApi = window.patchwright ?? createMockApi()

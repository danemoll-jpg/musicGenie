/// <reference types="vite/client" />
import type { MgApi } from '../../preload/index';

declare global {
  interface Window {
    mg: MgApi;
  }
}
export {};

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import importDynamicModule from '../dist'
import {resolve} from "path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), importDynamicModule()],
  resolve: {
    alias: [
      { find: /^~/, replacement: '' },
      { find: '@', replacement: resolve(__dirname, 'src') },
    ]
  }
})

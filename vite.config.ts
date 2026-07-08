import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig(() => ({
  base: '/2151-808/',
  // HTTPS=1 npm run dev -- --host : self-signed https for testing from other
  // devices on the LAN (AudioWorklet needs a secure context)
  plugins: process.env.HTTPS ? [basicSsl()] : [],
}))

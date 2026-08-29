import { defineConfig } from 'vite';
import { sites } from '@openai/sites-vite-plugin';

export default defineConfig({
    plugins: [sites()],
    build: {
        outDir: 'dist/client',
        emptyOutDir: true,
        copyPublicDir: false,
        rollupOptions: {
            input: 'hosting/site-entry.js',
        },
    },
});

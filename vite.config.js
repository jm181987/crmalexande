import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
// lucide-react is native ESM. Avoid running the CommonJS transformer over its
// very large re-export index (Rollup can fail with "Code is nested too deeply").
export default defineConfig({
 plugins:[react()],
 server:{proxy:{'/api':'http://localhost:3001'}},
 build:{outDir:'dist',commonjsOptions:{exclude:[/node_modules[\\/]lucide-react[\\/]/]}}
});

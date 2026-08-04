import esbuild from "esbuild";
import { createPluginBundlerPresets } from "@paperclipai/plugin-sdk/bundlers";

const presets = createPluginBundlerPresets({ uiEntry: "src/ui/index.tsx" });
const worker = await esbuild.context(presets.esbuild.worker);
const manifest = await esbuild.context(presets.esbuild.manifest);
const ui = await esbuild.context(presets.esbuild.ui);

await Promise.all([worker.rebuild(), manifest.rebuild(), ui.rebuild()]);
await Promise.all([worker.dispose(), manifest.dispose(), ui.dispose()]);

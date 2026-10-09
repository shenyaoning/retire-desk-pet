import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// 动画帧已随仓库放在 public/assets/animations；只有设置了环境变量才会从外部目录同步更新
const source = resolve(process.env.RETIRE_PET_ANIMATION_SOURCE ?? "public/assets/animations");
const target = resolve("public/assets/animations");
mkdirSync(target, { recursive: true });

const scanRoot = existsSync(source) ? source : target;
const directories = readdirSync(scanRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && /^\d{2}-/.test(entry.name))
  .map(entry => entry.name)
  .filter(name => existsSync(join(scanRoot, name, "anim.json")))
  .sort((a, b) => a.localeCompare(b, "zh-CN"));

if (scanRoot !== target) {
  for (const directory of directories) {
    cpSync(join(source, directory), join(target, directory), { recursive: true, force: true });
  }
}

const animations = directories.map(directory => ({
  id: `mood-${directory.slice(0, 2)}`,
  directory,
}));
writeFileSync(join(target, "index.json"), `${JSON.stringify({ animations }, null, 2)}\n`);
console.log(`已发现 ${animations.length} 组桌宠动画。`);

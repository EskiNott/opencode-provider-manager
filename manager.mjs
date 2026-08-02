#!/usr/bin/env node

import { loadSource, saveSource } from "./lib/common.mjs";
import { doctor, interactive, printProviders } from "./lib/menu.mjs";
import { syncProviders } from "./lib/sync.mjs";

function flags(argv) {
  return {
    dryRun: argv.includes("--dry-run"),
    listOnly: argv.includes("--list-only"),
    noModelsDev: argv.includes("--no-models-dev"),
    verbose: argv.includes("--verbose"),
    providerFilter: argv.includes("--provider") ? argv[argv.indexOf("--provider") + 1] : null,
  };
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  if (!command || command === "menu") return interactive();
  if (command === "sync") return syncProviders(flags(argv));
  if (command === "list") return printProviders(loadSource());
  if (command === "doctor") return doctor(loadSource());
  if (command === "migrate") {
    const source = loadSource();
    saveSource(source);
    console.log("配置迁移完成。");
    return;
  }
  if (["help", "--help", "-h"].includes(command)) {
    console.log(`用法：
  ./manage.sh                 进入交互菜单
  ./sync-models.sh            同步全部
  ./sync-models.sh --dry-run  只生成预览
  ./sync-models.sh --verbose  显示 effort 识别
  ./manage.sh list            查看供应商
  ./manage.sh doctor          检查配置`);
    return;
  }
  throw new Error(`未知命令：${command}`);
}

main().catch((error) => {
  console.error(`\n失败：${error.message}`);
  process.exitCode = 1;
});

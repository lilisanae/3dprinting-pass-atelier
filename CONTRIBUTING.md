# 参与贡献

欢迎修正问题、改善操作体验和补充文档。较大的功能请先开 Issue 讨论用户场景。

1. 使用锁定的 Node.js / pnpm 版本，执行 pnpm install --frozen-lockfile。
2. 修改相关模块，保留 version 1 项目格式与旧文件缺省行为。
3. 执行 pnpm build 和 pnpm test；涉及打印时补充导出、切片或实物结果，并明确没验证的部分。
4. PR 说明触发步骤、修改后的行为和检查结果。不要提交作品进度、账号数据、日志、凭据或个人目录。

src/model 保存领域规则，src/artwork 负责图像和字体路径，src/geometry 负责 Worker/实体，src/export 负责文件，src/io 负责本地保存，src/components 和 src/ui 负责交互。保持这些职责清晰即可，不必为一次小改动先重构整个工作台。

项目原创代码采用 MIT；新增图像、字体、示例、依赖时，请同时提供来源和许可说明。

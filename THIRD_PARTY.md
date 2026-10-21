# 第三方与素材说明

## 软件与文档

根 LICENSE 适用于本项目原创程序和公开文档。它不会重新许可第三方依赖，也不授予第三方商标、角色、图案或打印设计的权利。

运行依赖包括 React、React DOM、Three.js、Manifold 3D、ImageTracer.js、OpenType.js、svg-path-parser、fflate 和 Lucide React。构建时 scripts/collect-notices.mjs 会从已安装的直接运行依赖提取许可证，生成 public/assets/THIRD-PARTY-NOTICES.txt，随完整静态站发布。各包以自身许可和 NOTICE 为准；该脚本不是对所有传递依赖的法律审计。

## 字体

resources/fonts/NotoSansSC-Bold.otf 与 public/assets 下的分包字体来自 Noto CJK。相关处理脚本见 scripts/prepare-fonts.py、prepare-text-fonts.py。常规黑体和宋体的脚本固定上游 Noto CJK Sans2.004 / Serif2.003 来源。

字体按 SIL Open Font License 1.1 分发，保留原许可：

- public/assets/FONT-LICENSE.txt
- public/assets/text-sans-regular-LICENSE.txt
- public/assets/text-serif-regular-LICENSE.txt

上游：https://github.com/notofonts/noto-cjk 。字体原件与子集不因本项目 MIT 改为 MIT。

## 模板、案例与打印参数

通行证模板、参考图、默认案例和作者打印预设是应用演示/默认体验的一部分，沿用维护版本。涉及第三方标识、形象或外部素材的权利仍归相应权利人；本项目不对其作额外授权或商用保证。分享衍生作品前请自行确认素材来源与用途。

本次公开发布不包含原始 Blender 工程、私人作品、内部交接或操作记录。通行证模板的导出脚本作为可选离线工具提供，正常开发与构建不依赖 Blender 或 Python。

# Third-party notices

## Microsoft Codicons

The icons in `apps/webview/src/components/primitives/Icon.tsx` are from
[Microsoft Codicons](https://github.com/microsoft/vscode-codicons), the icon set VS Code itself
uses. The SVG sources are imported from the `@vscode/codicons` package at build time and inlined
into the webview bundle; only the icons actually referenced are included.

Codicon icons are licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

> Copyright (c) Microsoft Corporation
>
> Licensed under the Creative Commons Attribution 4.0 International Public License.

No changes are made to the glyph geometry. The wrapping `<svg>` element is replaced so the icon
inherits `currentColor` and an accessible label from the component that renders it.

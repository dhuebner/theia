// *****************************************************************************
// Copyright (C) 2023 TypeFox and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from '@theia/core/shared/react';
import { inject, injectable, interfaces, postConstruct } from '@theia/core/shared/inversify';
import { generateUuid } from '@theia/core/lib/common/uuid';
import {
    NotebookRendererMessagingService, CellOutputWebview, NotebookRendererRegistry,
    NotebookEditorWidgetService, NotebookCellOutputsSplice, NOTEBOOK_EDITOR_ID_PREFIX, NotebookKernelService, NotebookEditorWidget
} from '@theia/notebook/lib/browser';
import { NotebookCellModel } from '@theia/notebook/lib/browser/view-model/notebook-cell-model';
import { WebviewWidget } from '../../webview/webview';
import { Message, WidgetManager } from '@theia/core/lib/browser';
import { outputWebviewPreload, PreloadContext } from './output-webview-internal';
import { WorkspaceTrustService } from '@theia/workspace/lib/browser';
import { ChangePreferredMimetypeMessage, FromWebviewMessage, OutputChangedMessage } from './webview-communication';
import { CellUri } from '@theia/notebook/lib/common';
import { Disposable, DisposableCollection, nls, QuickPickService } from '@theia/core';
import { NotebookCellOutputModel } from '@theia/notebook/lib/browser/view-model/notebook-cell-output-model';
import { NotebookModel } from '@theia/notebook/lib/browser/view-model/notebook-model';
import { NotebookOptionsService, NotebookOutputOptions } from '@theia/notebook/lib/browser/service/notebook-options';

const CellModel = Symbol('CellModel');
const Notebook = Symbol('NotebookModel');
export const AdditionalNotebookCellOutputCss = Symbol('AdditionalNotebookCellOutputCss');

export function createCellOutputWebviewContainer(ctx: interfaces.Container, cell: NotebookCellModel, notebook: NotebookModel): interfaces.Container {
    const child = ctx.createChild();
    child.bind(CellModel).toConstantValue(cell);
    child.bind(Notebook).toConstantValue(notebook);
    child.bind(AdditionalNotebookCellOutputCss).toConstantValue(DEFAULT_NOTEBOOK_OUTPUT_CSS);
    child.bind(CellOutputWebviewImpl).toSelf().inSingletonScope();
    return child;
}

// Should be kept up-to-date with:
// https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/notebook/browser/view/renderers/webviewThemeMapping.ts
const mapping: ReadonlyMap<string, string> = new Map([
    ['theme-font-family', 'vscode-font-family'],
    ['theme-font-weight', 'vscode-font-weight'],
    ['theme-font-size', 'vscode-font-size'],
    ['theme-code-font-family', 'vscode-editor-font-family'],
    ['theme-code-font-weight', 'vscode-editor-font-weight'],
    ['theme-code-font-size', 'vscode-editor-font-size'],
    ['theme-scrollbar-background', 'vscode-scrollbarSlider-background'],
    ['theme-scrollbar-hover-background', 'vscode-scrollbarSlider-hoverBackground'],
    ['theme-scrollbar-active-background', 'vscode-scrollbarSlider-activeBackground'],
    ['theme-quote-background', 'vscode-textBlockQuote-background'],
    ['theme-quote-border', 'vscode-textBlockQuote-border'],
    ['theme-code-foreground', 'vscode-textPreformat-foreground'],
    // Editor
    ['theme-background', 'vscode-editor-background'],
    ['theme-foreground', 'vscode-editor-foreground'],
    ['theme-ui-foreground', 'vscode-foreground'],
    ['theme-link', 'vscode-textLink-foreground'],
    ['theme-link-active', 'vscode-textLink-activeForeground'],
    // Buttons
    ['theme-button-background', 'vscode-button-background'],
    ['theme-button-hover-background', 'vscode-button-hoverBackground'],
    ['theme-button-foreground', 'vscode-button-foreground'],
    ['theme-button-secondary-background', 'vscode-button-secondaryBackground'],
    ['theme-button-secondary-hover-background', 'vscode-button-secondaryHoverBackground'],
    ['theme-button-secondary-foreground', 'vscode-button-secondaryForeground'],
    ['theme-button-hover-foreground', 'vscode-button-foreground'],
    ['theme-button-focus-foreground', 'vscode-button-foreground'],
    ['theme-button-secondary-hover-foreground', 'vscode-button-secondaryForeground'],
    ['theme-button-secondary-focus-foreground', 'vscode-button-secondaryForeground'],
    // Inputs
    ['theme-input-background', 'vscode-input-background'],
    ['theme-input-foreground', 'vscode-input-foreground'],
    ['theme-input-placeholder-foreground', 'vscode-input-placeholderForeground'],
    ['theme-input-focus-border-color', 'vscode-focusBorder'],
    // Menus
    ['theme-menu-background', 'vscode-menu-background'],
    ['theme-menu-foreground', 'vscode-menu-foreground'],
    ['theme-menu-hover-background', 'vscode-menu-selectionBackground'],
    ['theme-menu-focus-background', 'vscode-menu-selectionBackground'],
    ['theme-menu-hover-foreground', 'vscode-menu-selectionForeground'],
    ['theme-menu-focus-foreground', 'vscode-menu-selectionForeground'],
    // Errors
    ['theme-error-background', 'vscode-inputValidation-errorBackground'],
    ['theme-error-foreground', 'vscode-foreground'],
    ['theme-warning-background', 'vscode-inputValidation-warningBackground'],
    ['theme-warning-foreground', 'vscode-foreground'],
    ['theme-info-background', 'vscode-inputValidation-infoBackground'],
    ['theme-info-foreground', 'vscode-foreground'],
    // Notebook:
    ['theme-notebook-output-background', 'vscode-notebook-outputContainerBackgroundColor'],
    ['theme-notebook-output-border', 'vscode-notebook-outputContainerBorderColor'],
    ['theme-notebook-cell-selected-background', 'vscode-notebook-selectedCellBackground'],
    ['theme-notebook-symbol-highlight-background', 'vscode-notebook-symbolHighlightBackground'],
    ['theme-notebook-diff-removed-background', 'vscode-diffEditor-removedTextBackground'],
    ['theme-notebook-diff-inserted-background', 'vscode-diffEditor-insertedTextBackground'],
]);

const constants: Record<string, string> = {
    'theme-input-border-width': '1px',
    'theme-button-primary-hover-shadow': 'none',
    'theme-button-secondary-hover-shadow': 'none',
    'theme-input-border-color': 'transparent',
};

export const DEFAULT_NOTEBOOK_OUTPUT_CSS = `
:root {
    ${Array.from(mapping.entries()).map(([key, value]) => `--${key}: var(--${value});`).join('\n')}
    ${Object.entries(constants).map(([key, value]) => `--${key}: ${value};`).join('\n')}
}

body {
    padding: 0;
}

table {
    border-collapse: collapse;
    border-spacing: 0;
}
  
table th,
table td {
    border: 1px solid;
}

table > thead > tr > th {
    text-align: left;
    border-bottom: 1px solid;
}

table > thead > tr > th,
table > thead > tr > td,
table > tbody > tr > th,
table > tbody > tr > td {
    padding: 5px 10px;
}

table > tbody > tr + tr > td {
    border-top: 1px solid;
}

table,
thead,
tr,
th,
td,
tbody {
    border: none !important;
    border-color: transparent;
    border-spacing: 0;
    border-collapse: collapse;
}

table,
th,
tr {
    vertical-align: middle;
    text-align: right;
}

thead {
    font-weight: bold;
    background-color: rgba(130, 130, 130, 0.16);
}

th,
td {
    padding: 4px 8px;
}

tr:nth-child(even) {
    background-color: rgba(130, 130, 130, 0.08);
}

tbody th {
    font-weight: normal;
}
`;

@injectable()
export class CellOutputWebviewImpl implements CellOutputWebview, Disposable {

    @inject(NotebookRendererMessagingService)
    protected readonly messagingService: NotebookRendererMessagingService;

    @inject(CellModel)
    protected readonly cell: NotebookCellModel;

    @inject(Notebook)
    protected readonly notebook: NotebookModel;

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(WorkspaceTrustService)
    protected readonly workspaceTrustService: WorkspaceTrustService;

    @inject(NotebookRendererRegistry)
    protected readonly notebookRendererRegistry: NotebookRendererRegistry;

    @inject(NotebookEditorWidgetService)
    protected readonly notebookEditorWidgetService: NotebookEditorWidgetService;

    @inject(NotebookKernelService)
    protected readonly notebookKernelService: NotebookKernelService;

    @inject(QuickPickService)
    protected readonly quickPickService: QuickPickService;

    @inject(AdditionalNotebookCellOutputCss)
    protected readonly additionalOutputCss: string;

    @inject(NotebookOptionsService)
    protected readonly notebookOptionsService: NotebookOptionsService;

    protected options: NotebookOutputOptions;

    readonly id = generateUuid();

    protected editor: NotebookEditorWidget | undefined;

    protected readonly elementRef = React.createRef<HTMLDivElement>();
    protected outputPresentationListeners: DisposableCollection = new DisposableCollection();

    protected webviewWidget: WebviewWidget;

    protected toDispose = new DisposableCollection();

    @postConstruct()
    protected async init(): Promise<void> {
        this.editor = this.notebookEditorWidgetService.getNotebookEditor(NOTEBOOK_EDITOR_ID_PREFIX + CellUri.parse(this.cell.uri)?.notebook);
        this.options = this.notebookOptionsService.computeOutputOptions();
        this.toDispose.push(this.notebookOptionsService.onDidChangeOutputOptions(options => {
            this.options = options;
            this.updateStyles();
        }));

        this.toDispose.push(this.cell.onDidChangeOutputs(outputChange => this.updateOutput(outputChange)));
        this.toDispose.push(this.cell.onDidChangeOutputItems(output => {
            this.updateOutput({ start: this.cell.outputs.findIndex(o => o.outputId === output.outputId), deleteCount: 1, newOutputs: [output] });
        }));

        if (this.editor) {
            this.toDispose.push(this.editor.onDidPostKernelMessage(message => {
                // console.log('from extension customKernelMessage ', JSON.stringify(message));
                this.webviewWidget.sendMessage({
                    type: 'customKernelMessage',
                    message
                });
            }));

            this.toDispose.push(this.editor.onPostRendererMessage(messageObj => {
                // console.log('from extension customRendererMessage ', JSON.stringify(messageObj));
                this.webviewWidget.sendMessage({
                    type: 'customRendererMessage',
                    ...messageObj
                });
            }));

        }

        this.webviewWidget = await this.widgetManager.getOrCreateWidget(WebviewWidget.FACTORY_ID, { id: this.id });
        this.webviewWidget.parent = this.editor ?? null;
        this.webviewWidget.setContentOptions({
            allowScripts: true,
            // eslint-disable-next-line max-len
            // list taken from https://github.com/microsoft/vscode/blob/a27099233b956dddc2536d4a0d714ab36266d897/src/vs/workbench/contrib/notebook/browser/view/renderers/backLayerWebView.ts#L762-L774
            enableCommandUris: [
                'github-issues.authNow',
                'workbench.extensions.search',
                'workbench.action.openSettings',
                '_notebook.selectKernel',
                'jupyter.viewOutput',
                'workbench.action.openLargeOutput',
                'cellOutput.enableScrolling',
            ],
        });
        this.webviewWidget.setHTML(await this.createWebviewContent());

        this.webviewWidget.onMessage((message: FromWebviewMessage) => {
            this.handleWebviewMessage(message);
        });
    }

    render(): React.JSX.Element {
        return <div className='theia-notebook-cell-output-webview' ref={this.elementRef}></div>;
    }

    attachWebview(): void {
        if (this.elementRef.current) {
            this.webviewWidget.processMessage(new Message('before-attach'));
            this.elementRef.current.appendChild(this.webviewWidget.node);
            this.webviewWidget.processMessage(new Message('after-attach'));
            this.webviewWidget.setIframeHeight(0);
        }
    }

    isAttached(): boolean {
        return this.elementRef.current?.contains(this.webviewWidget.node) ?? false;
    }

    updateOutput(update: NotebookCellOutputsSplice): void {
        if (this.webviewWidget.isHidden) {
            this.webviewWidget.show();
        }

        this.outputPresentationListeners.dispose();
        this.outputPresentationListeners = new DisposableCollection();
        for (const output of this.cell.outputs) {
            this.outputPresentationListeners.push(output.onRequestOutputPresentationChange(() => this.requestOutputPresentationUpdate(output)));
        }

        const updateOutputMessage: OutputChangedMessage = {
            type: 'outputChanged',
            newOutputs: update.newOutputs.map(output => ({
                id: output.outputId,
                items: output.outputs.map(item => ({ mime: item.mime, data: item.data.buffer })),
                metadata: output.metadata
            })),
            deleteStart: update.start,
            deleteCount: update.deleteCount
        };

        this.webviewWidget.sendMessage(updateOutputMessage);
    }

    private async requestOutputPresentationUpdate(output: NotebookCellOutputModel): Promise<void> {
        const selectedMime = await this.quickPickService.show(
            output.outputs.map(item => ({ label: item.mime })),
            { description: nls.localizeByDefault('Select mimetype to render for current output') });
        if (selectedMime) {
            this.webviewWidget.sendMessage({
                type: 'changePreferredMimetype',
                outputId: output.outputId,
                mimeType: selectedMime.label
            } as ChangePreferredMimetypeMessage);
        }
    }

    private handleWebviewMessage(message: FromWebviewMessage): void {
        if (!this.editor) {
            throw new Error('No editor found for cell output webview');
        }

        switch (message.type) {
            case 'initialized':
                this.updateOutput({ newOutputs: this.cell.outputs, start: 0, deleteCount: 0 });
                this.updateStyles();
                break;
            case 'customRendererMessage':
                // console.log('from webview customRendererMessage ', message.rendererId, '', JSON.stringify(message.message));
                this.messagingService.getScoped(this.editor.id).postMessage(message.rendererId, message.message);
                break;
            case 'didRenderOutput':
                this.webviewWidget.setIframeHeight(message.contentHeight + 5);
                break;
            case 'did-scroll-wheel':
                this.editor.node.getElementsByClassName('theia-notebook-viewport')[0].children[0].scrollBy(message.deltaX, message.deltaY);
                break;
            case 'customKernelMessage':
                // console.log('from webview customKernelMessage ', JSON.stringify(message.message));
                this.editor.recieveKernelMessage(message.message);
                break;
            case 'inputFocusChanged':
                this.editor?.outputInputFocusChanged(message.focused);
        }
    }

    getPreloads(): string[] {
        const kernel = this.notebookKernelService.getSelectedOrSuggestedKernel(this.notebook);
        const kernelPreloads = kernel?.preloadUris.map(uri => uri.toString()) ?? [];

        const staticPreloads = this.notebookRendererRegistry.staticNotebookPreloads
            .filter(preload => preload.type === this.notebook.viewType)
            .map(preload => preload.entrypoint);
        return kernelPreloads.concat(staticPreloads);
    }

    protected updateStyles(): void {
        this.webviewWidget.sendMessage({
            type: 'notebookStyles',
            styles: this.generateStyles()
        });
    }

    protected generateStyles(): { [key: string]: string } {
        return {
            'notebook-output-node-left-padding': `${this.options.outputNodeLeftPadding}px`,
            'notebook-cell-output-font-size': `${this.options.outputFontSize || this.options.fontSize}px`,
            'notebook-cell-output-line-height': `${this.options.outputLineHeight}px`,
            'notebook-cell-output-max-height': `${this.options.outputLineHeight * this.options.outputLineLimit}px`,
            'notebook-cell-output-font-family': this.options.outputFontFamily || this.options.fontFamily,
        };
    }

    private async createWebviewContent(): Promise<string> {
        const isWorkspaceTrusted = await this.workspaceTrustService.getWorkspaceTrust();
        const preloads = this.preloadsScriptString(isWorkspaceTrusted);
        const content = `
                <html>
                    <head>
                        <meta charset="UTF-8">
                        <style>
                            ${this.additionalOutputCss}
                        </style>
                    </head>
                    <body>
                        <script type="module">${preloads}</script>
                    </body>
                </html>
                `;
        return content;
    }

    private preloadsScriptString(isWorkspaceTrusted: boolean): string {
        const ctx: PreloadContext = {
            isWorkspaceTrusted,
            rendererData: this.notebookRendererRegistry.notebookRenderers,
            renderOptions: {
                lineLimit: this.options.outputLineLimit,
                outputScrolling: this.options.outputScrolling,
                outputWordWrap: this.options.outputWordWrap,
            },
            staticPreloadsData: this.getPreloads()
        };
        // TS will try compiling `import()` in webviewPreloads, so use a helper function instead
        // of using `import(...)` directly
        return `
            const __import = (x) => import(x);
                (${outputWebviewPreload})(JSON.parse(decodeURIComponent("${encodeURIComponent(JSON.stringify(ctx))}")))`;
    }

    dispose(): void {
        this.toDispose.dispose();
        this.outputPresentationListeners.dispose();
        this.webviewWidget.dispose();
    }
}

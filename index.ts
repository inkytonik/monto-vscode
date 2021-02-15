/*
 * This file is part of Monto VSCode.
 *
 * Copyright (C) 2021 Anthony M Sloane.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { commands, ExtensionContext, EventEmitter, Range, Selection, TextDocumentContentProvider, TextEditor, TextEditorRevealType, TextEditorSelectionChangeEvent, Uri, ViewColumn, workspace, window } from 'vscode';
import { NotificationType } from 'vscode-jsonrpc';
import { LanguageClient, DidChangeConfigurationNotification } from 'vscode-languageclient';

export namespace Monto {

    // Products

    export interface Product {
        uri: string;
        name: string;
        language: string;
        content: string;
        append: boolean;
        rangeMap: RangeEntry[];
        rangeMapRev: RangeEntry[];

        // Internal fields
        handleSelectionChange: boolean;
    }

    export interface RangeEntry {
        source: OffsetRange;
        targets: OffsetRange[];
    }

    export interface OffsetRange {
        start: number; end: number;
    }

    namespace PublishProduct {
        export const type = new NotificationType<Product, void>(
            "monto/publishProduct"
        );
    }

    // Map Monto uri strings to latest version of their products
    let products = new Map<string, Product>();

    // Map all uri strings to the view column in which they are displayed
    let columns = new Map<string, ViewColumn>();

    async function saveProduct(product: Product) {
        const uri = productToTargetUri(product);
        const uriStr = uri.toString();
        product.handleSelectionChange = false;
        if (product.append) {
            if (product.content === '') {
                montoProvider.onDidChangeEmitter.fire(uri);
            } else {
                const oldProduct = products.get(uriStr);
                if (oldProduct === undefined) {
                    products.set(uriStr, product);
                } else {
                    const len = oldProduct.content.length;
                    oldProduct.content = oldProduct.content.concat(product.content);
                    oldProduct.rangeMap = merge(oldProduct.rangeMap, product.rangeMap, len);
                    oldProduct.rangeMapRev = oldProduct.rangeMapRev.concat(shiftRev(product.rangeMapRev, len));
                }
            }
        } else {
            products.set(uriStr, product);
            await showProduct(product);
            montoProvider.onDidChangeEmitter.fire(uri);
        }
    }

    function merge(oldMap: RangeEntry[], newMap: RangeEntry[], offset: number): RangeEntry[] {
        newMap.forEach(entry =>
            entry.targets.forEach(range =>
                shiftRange(range, offset)
            )
        );
        if (oldMap.length === 0) {
            return newMap;
        } else {
            newMap.forEach(newEntry =>
                oldMap.forEach(oldEntry => {
                    if (oldEntry.source.start === newEntry.source.start &&
                        oldEntry.source.end === newEntry.source.end) {
                        oldEntry.targets = oldEntry.targets.concat(newEntry.targets);
                    }
                })
            );
            return oldMap;
        }
    }

    function shiftRev(map: RangeEntry[], offset: number): RangeEntry[] {
        map.forEach(entry =>
            shiftRange(entry.source, offset)
        );
        return map;
    }

    function shiftRange(range: OffsetRange, offset: number) {
        range.start += offset;
        range.end += offset;
    }

    async function showProduct(product: Product) {
        await openInEditor(productToTargetUri(product), true);
    }

    function getProduct(uri: Uri): Product {
        const p = products.get(uri.toString());
        if (p === undefined) {
            const dummyRange = {
                source: { start: 0, end: 0 },
                targets: [{ start: 0, end: 0 }]
            };
            return {
                uri: "",
                name: "",
                language: "",
                content: "",
                append: false,
                rangeMap: [dummyRange],
                rangeMapRev: [dummyRange],
                handleSelectionChange: false
            };
        } else {
            return p;
        }
    }

    function productToTargetUri(product: Product): Uri {
        const path = Uri.parse(product.uri).path;
        return Uri.parse(`monto:${path}-${product.name}.${product.language}`);
    }

    function targetUriToSourceUri(uri: Uri): Uri {
        const path = uri.path.substring(0, uri.path.lastIndexOf("-"));
        return Uri.parse(`file:${path}`);
    }

    // Monto URI scheme

    const montoScheme = 'monto';

    const montoProvider = new class implements TextDocumentContentProvider {
        onDidChangeEmitter = new EventEmitter<Uri>();

        provideTextDocumentContent(uri: Uri): string {
            const product = products.get(uri.toString());
            if (product === undefined) {
                return "unknown content";
            } else {
                return product.content;
            }
        }

        get onDidChange() {
            return this.onDidChangeEmitter.event;
        }

        dispose() {
            this.onDidChangeEmitter.dispose();
        }
    };

    // Setup

    export function setup(
        name: string,
        context: ExtensionContext,
        client: LanguageClient
    ) {
        window.onDidChangeTextEditorSelection(change => {
            if (isMontoEditor(change.textEditor)) {
                selectLinkedSourceRanges(change);
            }
        });

        window.onDidChangeTextEditorViewColumn(event => {
            const editor = event.textEditor;
            if (editor.viewColumn !== undefined) {
                columns.set(editor.document.uri.toString(), editor.viewColumn);
            }
        });

        workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration(name)) {
                sendConfigurationToServer(client, name);
            }
        });

        context.subscriptions.push(
            commands.registerCommand(`${name}.selectLinkedEditors`, () => {
                selectLinkedTargetRanges();
            })
        );

        context.subscriptions.push(workspace.registerTextDocumentContentProvider(montoScheme, montoProvider));

        client.clientOptions.initializationOptions = workspace.getConfiguration(name);

        client.onReady().then(_ => {
            client.onNotification(PublishProduct.type, product => {
                saveProduct(product);
            });
        });
    }

    function sendConfigurationToServer(client: LanguageClient, name: string) {
        client.sendNotification(
            DidChangeConfigurationNotification.type.method,
            { settings: workspace.getConfiguration(name) }
        );
    }

    function isMontoEditor(editor: TextEditor): Boolean {
        return editor.document.uri.scheme === 'monto';
    }

    // Source to target linking

    function selectLinkedTargetRanges() {
        const editor = window.activeTextEditor;
        if (editor !== undefined) {
            const sourceEditor = editor;
            const sourceUri = sourceEditor.document.uri.toString();
            const sourceSelections = sourceEditor.selections;
            window.visibleTextEditors.forEach(targetEditor => {
                if (isMontoEditor(targetEditor)) {
                    const targetUri = targetEditor.document.uri;
                    const targetSourceUri = targetUriToSourceUri(targetUri);
                    if (targetSourceUri.toString() === sourceUri) {
                        const product = getProduct(targetUri);
                        const targetSelections =
                            flatten(sourceSelections.map(sourceSelection =>
                                getSelections(product, sourceEditor, sourceSelection, targetEditor, true)
                            ));
                        if (targetSelections.length > 0) {
                            product.handleSelectionChange = false;
                            showSelections(targetUri, targetEditor, targetSelections, true);
                        }
                    }
                }
            });
        }
    }

    // Target to source linking

    function selectLinkedSourceRanges(change: TextEditorSelectionChangeEvent) {
        const targetEditor = change.textEditor;
        const targetUri = targetEditor.document.uri;
        const sourceUri = targetUriToSourceUri(targetUri);
        openInEditor(sourceUri, false).then(sourceEditor => {
            const product = getProduct(targetUri);
            if (product.handleSelectionChange) {
                const sourceSelections =
                    flatten(change.selections.map(targetSelection =>
                        getSelections(product, targetEditor, targetSelection, sourceEditor, false)
                    ));
                if (sourceSelections.length > 0) {
                    showSelections(sourceUri, sourceEditor, sourceSelections, false);
                }
            } else {
                product.handleSelectionChange = true;
            }
        });
    }

    // Utilities

    function flatten(ranges: Range[][]): Range[] {
        return ranges.reduce((a, b) => a.concat(b));
    }

    function getSelections(product: Product, fromEditor: TextEditor, fromSelection: Selection, toEditor: TextEditor, forward: boolean): Range[] {
        const fromOffset = fromEditor.document.offsetAt(fromSelection.start);
        const entry = findContainingRangeEntry(product, fromOffset, forward);
        if (entry === undefined) {
            return [new Range(0, 0, 0, 0)];
        } else {
            return targetsToSelections(toEditor, entry.targets);
        }
    }

    function findContainingRangeEntry(product: Product, offset: number, forward: boolean): RangeEntry | undefined {
        const map = forward ? product.rangeMap : product.rangeMapRev;
        return map.find(entry =>
            (entry.source.start <= offset) && (offset < entry.source.end)
        );
    }

    function targetsToSelections(editor: TextEditor, targets: OffsetRange[]): Range[] {
        return targets.map(target =>
            targetToSelection(editor, target)
        );
    }

    function targetToSelection(editor: TextEditor, target: OffsetRange): Range {
        const s = editor.document.positionAt(target.start);
        const f = editor.document.positionAt(target.end);
        return new Range(s, f);
    }

    function viewColumn(uri: Uri, isTarget: Boolean): ViewColumn {
        const key = uri.toString();
        const column = columns.get(key);
        if (column === undefined) {
            const original = isTarget ? ViewColumn.Two : ViewColumn.One;
            columns.set(key, original);
            return original;
        } else {
            return column;
        }
    }

    function showSelections(uri: Uri, editor: TextEditor, selections: Range[], isTarget: Boolean) {
        window.showTextDocument(
            editor.document,
            {
                preserveFocus: false,
                preview: false,
                viewColumn: viewColumn(uri, isTarget)
            }
        );
        editor.selections = selections.map(s => new Selection(s.start, s.end));
        editor.revealRange(selections[0], TextEditorRevealType.InCenterIfOutsideViewport);
    }

    function openInEditor(uri: Uri, isTarget: boolean): Thenable<TextEditor> {
        return window.showTextDocument(
            uri,
            {
                preserveFocus: true,
                preview: false,
                viewColumn: viewColumn(uri, isTarget)
            }
        );
    }

}

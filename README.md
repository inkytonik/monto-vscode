# Monto VSCode

Monto is a system for providing live-updating structured text products to text editors.

An example use case is for a programming language implementation.
As the user edits code in the language, the language server can provide products that give insight in to the workings of the implementation.
E.g., one view might show the abstract syntax tree produced by the compiler front-end.
Another might show the generated code.

Live updating means that the products are up-to-date as the user edits.
Also, linking between selections in edited files or in product text means that relationships can be explored.
E.g., clicking on a source tree node to select the text that corresponds to that node.

This module implements Monto support for Visual Studio Code and is designed for use with Code's language client infrastructure and a Monto-compatible language server.

Documentation on how to write a Monto-based language server is sparse at the moment.
Contact us if you are interested in exploring further.

## Contributors

Anthony Sloane (inkytonik)

## Basic Features

- Adds a new `monto/publishProduct` message from a Monto-based server to a VSCode language client extension.

- Products have the following structure:

    ```typescript
    export interface Product {
        uri: string;
        name: string;
        language: string;
        content: string;
        append: boolean;
        rangeMap: RangeEntry[];
        rangeMapRev: RangeEntry[];
    }

    export interface RangeEntry {
        source: OffsetRange;
        targets: OffsetRange[];
    }

    export interface OffsetRange {
        start: number; end: number;
    }
    ```

- Product fields have the following meanings
  - `uri`: the URI of the file resource to which this product refers,
  - `name`: the unique name of this product,
  - `language`: the name of the language in which the content of this product is written,
  - `content`: the textual content of the product,
  - `append`: whether the content should be appended to previously received content for this product or not, and
  - `rangeMap` (`rangeMapRev`): maps from offset ranges in the file resource to the product content (and vice versa).

- Monto displays the content of products as they are received. By default, a server should send updated products each time a file is saved. Thus, editing a file and watching its related products update provides a form of live coding environment.

- Selecting locations in the displayed content of a product will select the related locations in the file resource (if any).

## Optional features

- The `selectLinkedEditors` command selects related locations in the products based on the current selection in a file resource (if any). Setup this command in your extension's `package.json` as follows (where `Name` and `name` are the name of your extension):

   ```json
   {
     "category": "Name",
     "command": "name.selectLinkedEditors",
     "title": "Select Linked Editors"
   }
   ```

- If your extension defines an `updateOnChange` setting then servers that obey this setting will send products on every change, rather than just when files are saved. This option increases the number of messages significantly, but also improves live updating to be more immediate.

    Define the settings as follows in your `package.json` (where name is the name of your extension).

    ```json
    "name.updateOnChange": {
      "type": "boolean",
      "default": false,
      "description": "By default, updates are processed when a relevant file is opened or saved. If this setting is true, they are also updated after each change."
    }
    ```

## Usage (TypeScript)

Add the dependency to your `package.json`:

```json
"dependencies": {
    "vscode-languageclient": "^xx.xx.xx",
    "monto-vscode": "^2.0.0"
}
```

In your extension code:

```typescript
import { Monto } from 'monto-vscode';
```

Call the Monto setup in the activation function:

```typescript
export function activate(context: ExtensionContext) {
    ...
    client = new LanguageClient(...);
    Monto.setup(name, context, client);
    ...
    context.subscriptions.push(client.start());
}
```

`name` should be the name of your extension.

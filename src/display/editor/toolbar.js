/* Copyright 2023 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

class EditorToolbar {
  #toolbar = null;

  #editor;

  id = null;

  constructor(editor) {
    this.#editor = editor;
    this.id = `${this.#editor.id}-toolbar`;
  }

  render(editorProps = {}) {
    const editToolbar = (this.#toolbar = document.createElement("div"));
    editToolbar.className = "editToolbar";

    const position = this.#editor.toolbarPosition;
    const { style } = editToolbar;
    if (position) {
      style.top = `calc(${
        100 * position[1]
      }% + var(--editor-toolbar-vert-offset))`;
    } else {
      const rectangleDropdownWidth = 204;
      style.insetInlineEnd = `calc(50% - ${Math.floor(rectangleDropdownWidth / 2)}px)`;
      style.top = "calc(100% + var(--editor-toolbar-vert-offset))";
    }

    const props = {
      onDelete: this.#onDelete.bind(this),
      ...editorProps,
    };
    this.#editor._uiManager.addEditToolbarToEditor({
      id: this.id,
      editor: this.#editor,
      props,
      div: this.#toolbar,
    });

    return editToolbar;
  }

  hide() {
    this.#toolbar.classList.add("hidden");
  }

  show() {
    this.#toolbar.classList.remove("hidden");
  }

  #onDelete() {
    this.#editor._uiManager.delete();
  }

  remove() {
    this.#editor._uiManager.removeExternalElement({
      id: this.id,
    });

    this.#toolbar.remove();
  }
}

export { EditorToolbar };

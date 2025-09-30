/* Copyright 2022 Mozilla Foundation
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

import { AnnotationEditor } from "./editor.js";
import { AnnotationEditorType } from "../../shared/util.js";
import { Outliner } from "./outliner.js";

class LinkNodeEditor extends AnnotationEditor {
  #boxes;

  #clipPathId = null;

  #highlightDiv = null;

  #highlightOutlines = null;

  #id = null;

  #lastPoint = null;

  color = "#074294";

  targetId = null;

  static _l10nPromise;

  static _type = "link_node";

  static _editorType = AnnotationEditorType.LINK_NODE;

  constructor(params) {
    super({ ...params, name: "linkNodeEditor" });
    this.#boxes = params.boxes || null;
    this.targetId = params.targetId;
    this._isDraggable = false;

    if (this.#boxes) {
      this.#createOutlines();
      this.#addToDrawLayer();
      this.rotate(this.rotation);
    }
  }

  #createOutlines() {
    const outliner = new Outliner(this.#boxes, /* borderWidth = */ 0.001);
    this.#highlightOutlines = outliner.getUnderlinesAndStrikeouts();
    ({
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
    } = this.#highlightOutlines.box);

    // The last point is in the pages coordinate system.
    const { lastPoint } = this.#highlightOutlines.box;
    this.#lastPoint = [
      (lastPoint[0] - this.x) / this.width,
      (lastPoint[1] - this.y) / this.height,
    ];
  }

  static initialize(l10n) {
    AnnotationEditor.initialize(l10n);
  }

  /** @inheritdoc */
  get toolbarPosition() {
    return this.#lastPoint;
  }

  /** @inheritdoc */
  async addEditToolbar() {
    const toolbar = await super.addEditToolbar();
    if (!toolbar) {
      return null;
    }
    return toolbar;
  }

  /** @inheritdoc */
  disableEditing() {
    super.disableEditing();
    this.div.classList.toggle("disabled", true);
  }

  /** @inheritdoc */
  enableEditing() {
    super.enableEditing();
    this.div.classList.toggle("disabled", false);
  }

  /** @inheritdoc */
  fixAndSetPosition() {
    return super.fixAndSetPosition(0);
  }

  /** @inheritdoc */
  getRect(tx, ty) {
    return super.getRect(tx, ty, 0);
  }

  /** @inheritdoc */
  onceAdded() {
    this.parent.addUndoableEditor(this);
    if (
      !this.wasAddedFromApi &&
      this.targetId &&
      `${this._uiManager.linkNodeTargetId}` === `${this.targetId}`
    ) {
      this.div.focus();
    } else {
      this.hide();
    }
  }

  /** @inheritdoc */
  remove() {
    super.remove();
    this.#cleanDrawLayer();
  }

  /** @inheritdoc */
  rebuild() {
    if (!this.parent) {
      return;
    }
    super.rebuild();
    if (this.div === null) {
      return;
    }

    this.#addToDrawLayer();

    if (!this.isAttachedToDOM) {
      // At some point this editor was removed and we're rebuilting it,
      // hence we must add it to its parent.
      // TODO: Figure out what to do with this. Is this needed for when loading from API?
      this.parent.add(this);
    }
  }

  show() {
    this.parent.drawLayer.show(this.#id);
    this.div.classList.toggle("hidden", false);
  }

  hide() {
    this.parent.drawLayer.hide(this.#id);
    this.div.classList.toggle("hidden", true);
  }

  setParent(parent) {
    if (this.parent && !parent) {
      this.#cleanDrawLayer();
    } else if (parent) {
      this.#addToDrawLayer(parent);
    }
    super.setParent(parent);
  }

  #cleanDrawLayer() {
    if (this.#id === null || !this.parent) {
      return;
    }
    this.parent.drawLayer.remove(this.#id);
    this.#id = null;
  }

  #addToDrawLayer(parent = this.parent) {
    if (this.#id !== null) {
      return;
    }
    ({ id: this.#id } = parent.drawLayer.drawLinkNode(
      this.#highlightOutlines,
      this.color,
      1
    ));
  }

  static #rotateBbox({ x, y, width, height }, angle) {
    switch (angle) {
      case 90:
        return {
          x: 1 - y - height,
          y: x,
          width: height,
          height: width,
        };
      case 180:
        return {
          x: 1 - x - width,
          y: 1 - y - height,
          width,
          height,
        };
      case 270:
        return {
          x: y,
          y: 1 - x - width,
          width: height,
          height: width,
        };
    }
    return {
      x,
      y,
      width,
      height,
    };
  }

  /** @inheritdoc */
  rotate(angle) {
    const { drawLayer } = this.parent;
    drawLayer.rotate(this.#id, angle);
    drawLayer.updateBox(this.#id, LinkNodeEditor.#rotateBbox(this, angle));
  }

  /** @inheritdoc */
  render() {
    if (this.div) {
      return this.div;
    }

    const div = super.render();
    this.#highlightDiv = document.createElement("div");
    div.append(this.#highlightDiv);
    this.#highlightDiv.className = "internal";
    this.#highlightDiv.style.clipPath = this.#clipPathId;
    const [parentWidth, parentHeight] = this.parentDimensions;
    this.setDims(this.width * parentWidth, this.height * parentHeight);

    return div;
  }

  /** @inheritdoc */
  select() {
    super.select();
  }

  /** @inheritdoc */
  unselect() {
    super.unselect();
  }

  serialize() {
    return null;
  }

  deserialize() {
    return null;
  }

  serializeToJSON() {
    if (this.isEmpty()) {
      return null;
    }

    const rect = this.getRect(0, 0);

    return {
      annotationType: AnnotationEditorType.LINK_NODE,
      boxes: this.#boxes,
      pageIndex: this.pageIndex,
      rect,
      rotation: 0,
      text: this.selectedText || "",
      targetId: this.targetId,
    };
  }

  static deserializeFromJSON(data, parent, uiManager) {
    const editor = super.deserialize(data, parent, uiManager);

    const { rect } = data;

    const [pageWidth, pageHeight] = editor.pageDimensions;
    editor.width = (rect[2] - rect[0]) / pageWidth;
    editor.height = (rect[3] - rect[1]) / pageHeight;
    editor.#boxes = data.boxes;
    editor.selectedText = data.text || "";
    editor.targetId = data.targetId;

    editor.#createOutlines();
    editor.#addToDrawLayer();
    editor.rotate(editor.rotation);
    editor.ignoreNextChangeEvent = true;
    editor.wasAddedFromApi = true;

    return editor;
  }

  static canCreateNewEmptyEditor() {
    return false;
  }
}

export { LinkNodeEditor };

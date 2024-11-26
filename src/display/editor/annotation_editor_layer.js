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

// eslint-disable-next-line max-len
/** @typedef {import("./tools.js").AnnotationEditorUIManager} AnnotationEditorUIManager */
/** @typedef {import("../display_utils.js").PageViewport} PageViewport */
// eslint-disable-next-line max-len
/** @typedef {import("../../../web/text_accessibility.js").TextAccessibilityManager} TextAccessibilityManager */
/** @typedef {import("../../../web/interfaces").IL10n} IL10n */
// eslint-disable-next-line max-len
/** @typedef {import("../annotation_layer.js").AnnotationLayer} AnnotationLayer */
/** @typedef {import("../draw_layer.js").DrawLayer} DrawLayer */

import {
  AnnotationEditorType,
  FeatureTest,
  getUuid,
} from "../../shared/util.js";
import { AnnotationEditor } from "./editor.js";
import { FreeTextEditor } from "./freetext.js";
import { HighlightEditor } from "./highlight.js";
import { InkEditor } from "./ink.js";
import { LinkNodeEditor } from "./link_node.js";
import { setLayerDimensions } from "../display_utils.js";
import { SquareEditor } from "./square.js";
import { StampEditor } from "./stamp.js";
import { StrikeoutEditor } from "./strikeout.js";
import { TempHighlight } from "./temp_highlight.js";
import { TextEditor } from "./text.js";
import { UnderlineEditor } from "./underline.js";

/**
 * @typedef {Object} AnnotationEditorLayerOptions
 * @property {Object} mode
 * @property {HTMLDivElement} div
 * @property {AnnotationEditorUIManager} uiManager
 * @property {boolean} enabled
 * @property {TextAccessibilityManager} [accessibilityManager]
 * @property {number} pageIndex
 * @property {IL10n} l10n
 * @property {AnnotationLayer} [annotationLayer]
 * @property {HTMLDivElement} [textLayer]
 * @property {DrawLayer} drawLayer
 * @property {PageViewport} viewport
 */

/**
 * @typedef {Object} RenderEditorLayerOptions
 * @property {PageViewport} viewport
 */

/**
 * Manage all the different editors on a page.
 */
class AnnotationEditorLayer {
  #accessibilityManager;

  #allowClick = false;

  #annotationLayer = null;

  #boundPointerup = this.pointerup.bind(this);

  #boundPointerUpAfterSelection = this.pointerUpAfterSelection.bind(this);

  #boundPointerdown = this.pointerdown.bind(this);

  #editorFocusTimeoutId = null;

  #boundSelectionStart = this.selectionStart.bind(this);

  #editors = new Map();

  #hadPointerDown = false;

  #isCleaningUp = false;

  #isDisabling = false;

  #textLayer = null;

  #uiManager;

  #textSelectionMode = "annotate";

  #tempHighlight = null;

  #linkNodeParams = null;

  #highlightSelectionParams = null;

  static _initialized = false;

  static #editorTypes = new Map(
    [
      FreeTextEditor,
      InkEditor,
      TextEditor,
      SquareEditor,
      StampEditor,
      HighlightEditor,
      UnderlineEditor,
      StrikeoutEditor,
    ].map(type => [type._editorType, type])
  );

  /**
   * @param {AnnotationEditorLayerOptions} options
   */
  constructor({
    uiManager,
    pageIndex,
    div,
    accessibilityManager,
    annotationLayer,
    drawLayer,
    textLayer,
    viewport,
    l10n,
  }) {
    const editorTypes = [...AnnotationEditorLayer.#editorTypes.values()];
    if (!AnnotationEditorLayer._initialized) {
      AnnotationEditorLayer._initialized = true;
      for (const editorType of editorTypes) {
        editorType.initialize(l10n);
      }
    }
    uiManager.registerEditorTypes(editorTypes);

    this.#uiManager = uiManager;
    this.pageIndex = pageIndex;
    this.div = div;
    this.#accessibilityManager = accessibilityManager;
    this.#annotationLayer = annotationLayer;
    this.viewport = viewport;
    this.#textLayer = textLayer;
    this.drawLayer = drawLayer;

    this.#uiManager.addLayer(this);
  }

  get isEmpty() {
    return this.#editors.size === 0;
  }

  /**
   * Update the toolbar if it's required to reflect the tool currently used.
   * @param {number} mode
   */
  updateModeAndToolbar(mode) {
    this.#uiManager.updateModeAndToolbar(mode);
  }

  /**
   * The mode has changed: it must be updated.
   * @param {number} mode
   */
  updateMode(mode = this.#uiManager.getMode()) {
    this.#cleanup();
    switch (mode) {
      case AnnotationEditorType.NONE:
        this.enableTextSelection("generic");
        this.togglePointerEvents(false);
        this.disableClick();
        break;
      case AnnotationEditorType.INK:
        // We always want to have an ink editor ready to draw in.
        this.addInkEditorIfNeeded(false);

        this.disableTextSelection();
        this.togglePointerEvents(true);
        this.disableClick();
        break;
      case AnnotationEditorType.SQUARE:
        // We always want to have a square editor ready to draw in.
        this.addSquareEditorIfNeeded(false);

        this.disableTextSelection();
        this.togglePointerEvents(true);
        this.disableClick();
        break;
      case AnnotationEditorType.UNDERLINE:
      case AnnotationEditorType.HIGHLIGHT:
      case AnnotationEditorType.STRIKEOUT:
        this.enableTextSelection();
        this.togglePointerEvents(false);
        this.disableClick();
        break;
      default:
        this.disableTextSelection();
        this.togglePointerEvents(true);
        this.enableClick();
    }

    if (mode !== AnnotationEditorType.NONE) {
      const { classList } = this.div;
      for (const editorType of AnnotationEditorLayer.#editorTypes.values()) {
        classList.toggle(
          `${editorType._type}Editing`,
          mode === editorType._editorType
        );
      }
    }

    this.div.hidden = false;
  }

  // TODO: Find a better way to do this
  // Currently it breaks the updateMode state
  afterAnnotationsLoaded() {
    this.#cleanup();
    this.togglePointerEvents(false);
    this.disableClick();

    this.div.hidden = false;
  }

  // TODO: Call this only once after both loading events
  afterLinkNodesLoaded() {
    this.afterAnnotationsLoaded();
  }

  #addEditorIfNeeded(isCommitting, editorName = "squareEditor") {
    if (!isCommitting) {
      // We're removing an editor but an empty one can already exist so in this
      // case we don't need to create a new one.
      for (const editor of this.#editors.values()) {
        if (editor.isEmpty() && editor.name === editorName) {
          editor.setInBackground();
          return;
        }
      }
    }

    const editor = this.#createAndAddNewEditor(
      { offsetX: 0, offsetY: 0 },
      /* isCentered = */ false
    );
    editor.setInBackground();
  }

  addInkEditorIfNeeded(isCommitting) {
    if (this.#uiManager.getMode() !== AnnotationEditorType.INK) {
      // We don't want to add an ink editor if we're not in ink mode!
      return;
    }

    this.#addEditorIfNeeded(isCommitting, "inkEditor");
  }

  addSquareEditorIfNeeded(isCommitting) {
    if (this.#uiManager.getMode() !== AnnotationEditorType.SQUARE) {
      // We don't want to add a square editor if we're not in square mode!
      return;
    }

    this.#addEditorIfNeeded(isCommitting, "squareEditor");
  }

  /**
   * Set the editing state.
   * @param {boolean} isEditing
   */
  setEditingState(isEditing) {
    this.#uiManager.setEditingState(isEditing);
  }

  /**
   * Add some commands into the CommandManager (undo/redo stuff).
   * @param {Object} params
   */
  addCommands(params, editor) {
    this.#uiManager.addCommands(params, editor);
  }

  togglePointerEvents(enabled = false) {
    this.div.classList.toggle("disabled", !enabled);
  }

  /**
   * Enable pointer events on the main div in order to enable
   * editor creation.
   */
  enable() {
    this.togglePointerEvents(true);
    const annotationElementIds = new Set();
    for (const editor of this.#editors.values()) {
      editor.enableEditing();
      if (editor.annotationElementId) {
        annotationElementIds.add(editor.annotationElementId);
      }
    }

    if (!this.#annotationLayer) {
      return;
    }

    /**
     * TODO: Remove this feature completely
     * pdf.js has internal support for editing freeText annotations
     */
    const editables = this.#annotationLayer.getEditableAnnotations();
    const disabled = true;
    for (const editable of editables) {
      // The element must be hidden whatever its state is.
      editable.hide();
      if (this.#uiManager.isDeletedAnnotationElement(editable.data.id)) {
        continue;
      }
      if (annotationElementIds.has(editable.data.id)) {
        continue;
      }
      const editor = this.deserialize(editable);
      if (disabled || !editor) {
        continue;
      }
      this.addOrRebuild(editor);
      editor.enableEditing();
    }
  }

  /**
   * Disable editor creation.
   */
  disable() {
    this.#isDisabling = true;
    this.togglePointerEvents(false);
    const hiddenAnnotationIds = new Set();
    for (const editor of this.#editors.values()) {
      if (editor.name === "linkNodeEditor") {
        continue;
      }

      if (!editor.annotationElementId || editor.serialize() !== null) {
        hiddenAnnotationIds.add(editor.annotationElementId);
        continue;
      }
      this.getEditableAnnotation(editor.annotationElementId)?.show();
      editor.remove();
    }

    if (this.#annotationLayer) {
      // Show the annotations that were hidden in enable().
      const editables = this.#annotationLayer.getEditableAnnotations();
      for (const editable of editables) {
        const { id } = editable.data;
        if (
          hiddenAnnotationIds.has(id) ||
          this.#uiManager.isDeletedAnnotationElement(id)
        ) {
          continue;
        }
        editable.show();
      }
    }

    this.#cleanup();
    if (this.isEmpty) {
      this.div.hidden = true;
    }
    const { classList } = this.div;
    for (const editorType of AnnotationEditorLayer.#editorTypes.values()) {
      classList.remove(`${editorType._type}Editing`);
    }
    this.disableTextSelection();

    this.#isDisabling = false;
  }

  getEditableAnnotation(id) {
    return this.#annotationLayer?.getEditableAnnotation(id) || null;
  }

  /**
   * Set the current editor.
   * @param {AnnotationEditor} editor
   */
  setActiveEditor(editor) {
    const currentActive = this.#uiManager.getActive();
    if (currentActive === editor) {
      return;
    }

    this.#uiManager.setActiveEditor(editor);
  }

  enableTextSelection(selectionMode = "annotate") {
    this.#textSelectionMode = selectionMode;

    if (this.#textLayer?.div) {
      document.addEventListener("selectstart", this.#boundSelectionStart);
    }
  }

  disableTextSelection() {
    if (this.#textLayer?.div) {
      document.removeEventListener("selectstart", this.#boundSelectionStart);
    }
  }

  enableClick() {
    this.div.addEventListener("pointerdown", this.#boundPointerdown);
    this.div.addEventListener("pointerup", this.#boundPointerup);
  }

  disableClick() {
    this.div.removeEventListener("pointerdown", this.#boundPointerdown);
    this.div.removeEventListener("pointerup", this.#boundPointerup);
  }

  attach(editor) {
    this.#editors.set(editor.id, editor);
    const { annotationElementId } = editor;
    if (
      annotationElementId &&
      this.#uiManager.isDeletedAnnotationElement(annotationElementId)
    ) {
      this.#uiManager.removeDeletedAnnotationElement(editor);
    }
  }

  detach(editor) {
    this.#editors.delete(editor.id);
    this.#accessibilityManager?.removePointerInTextLayer(editor.contentDiv);

    if (!this.#isDisabling && editor.annotationElementId) {
      this.#uiManager.addDeletedAnnotationElement(editor);
    }
  }

  /**
   * Remove an editor.
   * @param {AnnotationEditor} editor
   */
  remove(editor) {
    // Since we can undo a removal we need to keep the
    // parent property as it is, so don't null it!

    this.detach(editor);
    this.#uiManager.removeEditor(editor);
    editor.div.remove();
    editor.isAttachedToDOM = false;

    if (!this.#isCleaningUp) {
      this.addInkEditorIfNeeded(/* isCommitting = */ false);
    }
  }

  /**
   * An editor can have a different parent, for example after having
   * being dragged and droped from a page to another.
   * @param {AnnotationEditor} editor
   */
  changeParent(editor) {
    if (editor.parent === this) {
      return;
    }

    if (editor.annotationElementId) {
      this.#uiManager.addDeletedAnnotationElement(editor.annotationElementId);
      AnnotationEditor.deleteAnnotationElement(editor);
      editor.annotationElementId = null;
    }

    this.attach(editor);
    editor.parent?.detach(editor);
    editor.setParent(this);
    if (editor.div && editor.isAttachedToDOM) {
      editor.div.remove();
      this.div.append(editor.div);
    }
  }

  /**
   * Add a new editor in the current view.
   * @param {AnnotationEditor} editor
   */
  add(editor, isTempHighlight = false) {
    this.changeParent(editor);
    if (!isTempHighlight) {
      this.#uiManager.addEditor(editor);
      this.attach(editor);
    }

    if (!editor.isAttachedToDOM) {
      const div = editor.render();
      this.div.append(div);
      editor.isAttachedToDOM = true;
    }

    // The editor will be correctly moved into the DOM (see fixAndSetPosition).
    editor.fixAndSetPosition();
    editor.onceAdded();
    if (!isTempHighlight) {
      this.#uiManager.addToAnnotationStorage(editor);
    }

    /**
     * These editors have different lifecycle where annotation is added
     * instantly but reshaped later on
     * We don't want to reset the annotation mode until the shape is final
     * and then call "resetAnnotationMode" manually in the "commit" function
     * For highlight annotations mode is turned off manually
     */
    if (
      ![
        AnnotationEditorType.SQUARE,
        AnnotationEditorType.INK,
        AnnotationEditorType.HIGHLIGHT,
        AnnotationEditorType.UNDERLINE,
        AnnotationEditorType.STRIKEOUT,
      ].includes(editor.constructor._editorType)
    ) {
      this.resetAnnotationMode();
    }
  }

  resetAnnotationMode() {
    if (this.#uiManager.getMode() !== AnnotationEditorType.NONE) {
      this.#uiManager.updateModeAndToolbar(AnnotationEditorType.NONE);
    }
  }

  moveEditorInDOM(editor) {
    if (!editor.isAttachedToDOM) {
      return;
    }

    const { activeElement } = document;
    if (editor.div.contains(activeElement) && !this.#editorFocusTimeoutId) {
      // When the div is moved in the DOM the focus can move somewhere else,
      // so we want to be sure that the focus will stay on the editor but we
      // don't want to call any focus callbacks, hence we disable them and only
      // re-enable them when the editor has the focus.
      editor._focusEventsAllowed = false;
      this.#editorFocusTimeoutId = setTimeout(() => {
        this.#editorFocusTimeoutId = null;
        if (!editor.div.contains(document.activeElement)) {
          editor.div.addEventListener(
            "focusin",
            () => {
              editor._focusEventsAllowed = true;
            },
            { once: true }
          );
          activeElement.focus();
        } else {
          editor._focusEventsAllowed = true;
        }
      }, 0);
    }

    editor._structTreeParentId = this.#accessibilityManager?.moveElementInDOM(
      this.div,
      editor.div,
      editor.contentDiv,
      /* isRemovable = */ true
    );
  }

  /**
   * Add or rebuild depending if it has been removed or not.
   * @param {AnnotationEditor} editor
   */
  addOrRebuild(editor) {
    if (editor.needsToBeRebuilt()) {
      editor.parent ||= this;
      editor.rebuild();
    } else {
      this.add(editor);
    }
  }

  /**
   * Add a new editor and make this addition undoable.
   * @param {AnnotationEditor} editor
   */
  addUndoableEditor(editor) {
    const cmd = () => editor._uiManager.rebuild(editor);
    const undo = () => {
      editor.remove();
    };

    this.addCommands(
      { cmd, undo, mustExec: false, removesOnUndo: true },
      editor
    );
  }

  /**
   * Get an id for an editor.
   * @returns {string}
   */
  getNextId() {
    return this.#uiManager.getId();
  }

  get #currentEditorType() {
    return AnnotationEditorLayer.#editorTypes.get(this.#uiManager.getMode());
  }

  /**
   * Create a new editor
   * @param {Object} params
   * @returns {AnnotationEditor}
   */
  #createNewEditor(params) {
    const editorType = this.#currentEditorType;
    return editorType ? new editorType.prototype.constructor(params) : null;
  }

  canCreateNewEmptyEditor() {
    return this.#currentEditorType?.canCreateNewEmptyEditor();
  }

  /**
   * Paste some content into a new editor.
   * @param {number} mode
   * @param {Object} params
   */
  pasteEditor(mode, params) {
    const { offsetX, offsetY } = this.#getCenterPoint();
    const id = this.getNextId();
    const editor = this.#createNewEditor({
      parent: this,
      id,
      x: offsetX,
      y: offsetY,
      uiManager: this.#uiManager,
      isCentered: true,
      ...params,
    });
    if (editor) {
      this.add(editor);
    }
  }

  /**
   * Create a new editor
   * @param {Object} data
   * @returns {AnnotationEditor | null}
   */
  deserialize(data) {
    return (
      AnnotationEditorLayer.#editorTypes
        .get(data.annotationType ?? data.annotationEditorType)
        ?.deserialize(data, this, this.#uiManager) || null
    );
  }

  deserializeFromJSON(data) {
    return (
      AnnotationEditorLayer.#editorTypes
        .get(data.annotationType ?? data.annotationEditorType)
        ?.deserializeFromJSON(data, this, this.#uiManager) || null
    );
  }

  deserializeLinkNode(data) {
    return (
      LinkNodeEditor.deserializeFromJSON(data, this, this.#uiManager) || null
    );
  }

  /**
   * Create and add a new editor.
   * @param {PointerEvent} event
   * @param {boolean} isCentered
   * @param [Object] data
   * @returns {AnnotationEditor}
   */
  #createAndAddNewEditor(event, isCentered, data = {}) {
    const id = this.getNextId();
    const editor = this.#createNewEditor({
      parent: this,
      id,
      x: event.offsetX,
      y: event.offsetY,
      uiManager: this.#uiManager,
      isCentered,
      ...data,
    });
    if (editor) {
      this.add(editor);
    }

    return editor;
  }

  #getCenterPoint() {
    const { x, y, width, height } = this.div.getBoundingClientRect();
    const tlX = Math.max(0, x);
    const tlY = Math.max(0, y);
    const brX = Math.min(window.innerWidth, x + width);
    const brY = Math.min(window.innerHeight, y + height);
    const centerX = (tlX + brX) / 2 - x;
    const centerY = (tlY + brY) / 2 - y;
    const [offsetX, offsetY] =
      this.viewport.rotation % 180 === 0
        ? [centerX, centerY]
        : [centerY, centerX];

    return { offsetX, offsetY };
  }

  /**
   * Create and add a new editor.
   */
  addNewEditor() {
    this.#createAndAddNewEditor(
      this.#getCenterPoint(),
      /* isCentered = */ true
    );
  }

  /**
   * Set the last selected editor.
   * @param {AnnotationEditor} editor
   */
  setSelected(editor) {
    this.#uiManager.setSelected(editor);
  }

  /**
   * Add or remove an editor the current selection.
   * @param {AnnotationEditor} editor
   */
  toggleSelected(editor) {
    this.#uiManager.toggleSelected(editor);
  }

  /**
   * Check if the editor is selected.
   * @param {AnnotationEditor} editor
   */
  isSelected(editor) {
    return this.#uiManager.isSelected(editor);
  }

  /**
   * Unselect an editor.
   * @param {AnnotationEditor} editor
   */
  unselect(editor) {
    this.#uiManager.unselect(editor);
  }

  /**
   * SelectionChange callback.
   * @param {Event} _event
   */
  selectionStart(_event) {
    this.#textLayer?.div.addEventListener(
      "pointerup",
      this.#boundPointerUpAfterSelection,
      { once: true }
    );
  }

  removeTempHighlight() {
    if (!this.#tempHighlight) {
      return;
    }

    this.#tempHighlight.remove();
    this.#tempHighlight = null;
    this.#highlightSelectionParams = null;
  }

  addTempHighlight(event, data) {
    if (this.#textSelectionMode !== "generic") {
      return;
    }
    this.removeTempHighlight();

    const params = {
      parent: this,
      x: event.offsetX,
      y: event.offsetY,
      uiManager: this.#uiManager,
      isCentered: false,
      ...data,
    };

    this.#linkNodeParams = { ...params };

    this.#highlightSelectionParams = {
      event,
      data,
    };

    const linkNodeHandler = () => {
      this.#uiManager.dispatchLinkNodeReady();
    };

    params.linkNodeHandler = linkNodeHandler;
    params.highlightHandler = ({ color, type }) => {
      this.createAnnotationNode({ color, type });
      this.removeTempHighlight();
    };

    // Use getUuid instead of getNextId to avoid duplicate ID when temp
    // highlight is converted to a highlight/underline annotation
    // This ID is used CSS selctor so it should not start with number
    const id = "temp-highlight-" + getUuid();
    const editor = new TempHighlight.prototype.constructor({
      ...params,
      id,
    });
    this.#tempHighlight = editor;
    this.add(editor, true);
  }

  createLinkNode(targetId) {
    this.removeTempHighlight();
    const editor = new LinkNodeEditor.prototype.constructor({
      ...this.#linkNodeParams,
      id: "link-node-" + getUuid(),
      targetId,
    });
    this.add(editor);
    this.#linkNodeParams = null;
  }

  createAnnotationNode({
    color = null,
    type = AnnotationEditorType.HIGHLIGHT,
  } = {}) {
    const editorType = this.#currentEditorType;
    if (editorType) {
      const { event, data } = this.#highlightSelectionParams;
      this.#createAndAddNewEditor(event, false, data);
    } else {
      const editorClass = AnnotationEditorLayer.#editorTypes.get(type);
      if (editorClass) {
        const id = this.getNextId();
        const editor = new editorClass.prototype.constructor({
          // TODO: Use highlightSelectionParams only
          ...this.#linkNodeParams,
          id,
          color,
        });
        this.add(editor);
      }
      this.#linkNodeParams = null;
    }
  }

  get hasTempHighlight() {
    return Boolean(this.#tempHighlight);
  }

  /**
   * Called when the user releases the mouse button after having selected
   * some text.
   * @param {PointerEvent} event
   */
  pointerUpAfterSelection(event) {
    this.#uiManager.unselectAll();
    const selection = document.getSelection();
    if (selection.rangeCount === 0) {
      this.removeTempHighlight();
      return;
    }
    const range = selection.getRangeAt(0);
    if (range.collapsed) {
      this.removeTempHighlight();
      return;
    }

    if (!this.#textLayer?.div.contains(range.commonAncestorContainer)) {
      this.removeTempHighlight();
      return;
    }

    const {
      x: layerX,
      y: layerY,
      width: parentWidth,
      height: parentHeight,
    } = this.#textLayer.div.getBoundingClientRect();
    const bboxes = range.getClientRects();

    // We must rotate the boxes because we want to have them in the non-rotated
    // page coordinates.
    let rotator;
    switch (this.viewport.rotation) {
      case 90:
        rotator = (x, y, w, h) => ({
          x: (y - layerY) / parentHeight,
          y: 1 - (x + w - layerX) / parentWidth,
          width: h / parentHeight,
          height: w / parentWidth,
        });
        break;
      case 180:
        rotator = (x, y, w, h) => ({
          x: 1 - (x + w - layerX) / parentWidth,
          y: 1 - (y + h - layerY) / parentHeight,
          width: w / parentWidth,
          height: h / parentHeight,
        });
        break;
      case 270:
        rotator = (x, y, w, h) => ({
          x: 1 - (y + h - layerY) / parentHeight,
          y: (x - layerX) / parentWidth,
          width: h / parentHeight,
          height: w / parentWidth,
        });
        break;
      default:
        rotator = (x, y, w, h) => ({
          x: (x - layerX) / parentWidth,
          y: (y - layerY) / parentHeight,
          width: w / parentWidth,
          height: h / parentHeight,
        });
        break;
    }

    let boxes = [];
    for (const { x, y, width, height } of bboxes) {
      if (width === 0 || height === 0) {
        continue;
      }
      boxes.push(rotator(x, y, width, height));
    }

    // This only happens when mouse up event happens on empty space
    // TODO: This is a workaround. Fix issue where invalid div is added to bbox
    if (range.endContainer === this.#textLayer?.div) {
      boxes = boxes.slice(0, -1);
    }

    if (this.#textSelectionMode === "generic") {
      if (boxes.length) {
        this.addTempHighlight(event, {
          boxes,
          text: selection.toString(),
        });
      } else {
        this.removeTempHighlight();
      }
    } else if (boxes.length !== 0) {
      this.#createAndAddNewEditor(event, false, {
        boxes,
        text: selection.toString(),
      });
    }

    selection.empty();
  }

  /**
   * Pointerup callback.
   * @param {PointerEvent} event
   */
  pointerup(event) {
    const { isMac } = FeatureTest.platform;
    if (event.button !== 0 || (event.ctrlKey && isMac)) {
      // Don't create an editor on right click.
      return;
    }

    if (event.target !== this.div) {
      return;
    }

    if (!this.#hadPointerDown) {
      // It can happen when the user starts a drag inside a text editor
      // and then releases the mouse button outside of it. In such a case
      // we don't want to create a new editor, hence we check that a pointerdown
      // occurred on this div previously.
      return;
    }
    this.#hadPointerDown = false;

    if (!this.#allowClick) {
      this.#allowClick = true;
      return;
    }

    if (this.#uiManager.getMode() === AnnotationEditorType.STAMP) {
      this.#uiManager.unselectAll();
      return;
    }

    this.#createAndAddNewEditor(event, /* isCentered = */ false);
  }

  /**
   * Pointerdown callback.
   * @param {PointerEvent} event
   */
  pointerdown(event) {
    if (
      [
        AnnotationEditorType.HIGHLIGHT,
        AnnotationEditorType.UNDERLINE,
        AnnotationEditorType.STRIKEOUT,
      ].includes(this.#uiManager.getMode())
    ) {
      this.enableTextSelection();
    }
    if (this.#hadPointerDown) {
      // It's possible to have a second pointerdown event before a pointerup one
      // when the user puts a finger on a touchscreen and then add a second one
      // to start a pinch-to-zoom gesture.
      // That said, in case it's possible to have two pointerdown events with
      // a mouse, we don't want to create a new editor in such a case either.
      this.#hadPointerDown = false;
      return;
    }
    const { isMac } = FeatureTest.platform;
    if (event.button !== 0 || (event.ctrlKey && isMac)) {
      // Do nothing on right click.
      return;
    }

    if (event.target !== this.div) {
      return;
    }

    this.#hadPointerDown = true;

    const editor = this.#uiManager.getActive();
    this.#allowClick = !editor || editor.isEmpty();
  }

  /**
   *
   * @param {AnnotationEditor} editor
   * @param {number} x
   * @param {number} y
   * @returns
   */
  findNewParent(editor, x, y) {
    const layer = this.#uiManager.findParent(x, y);
    if (layer === null || layer === this) {
      return false;
    }
    layer.changeParent(editor);
    return true;
  }

  /**
   * Destroy the main editor.
   */
  destroy() {
    if (this.#uiManager.getActive()?.parent === this) {
      // We need to commit the current editor before destroying the layer.
      this.#uiManager.commitOrRemove();
      this.#uiManager.setActiveEditor(null);
    }

    if (this.#editorFocusTimeoutId) {
      clearTimeout(this.#editorFocusTimeoutId);
      this.#editorFocusTimeoutId = null;
    }

    for (const editor of this.#editors.values()) {
      this.#accessibilityManager?.removePointerInTextLayer(editor.contentDiv);
      editor.setParent(null);
      editor.isAttachedToDOM = false;
      editor.div.remove();
    }
    this.div = null;
    this.#editors.clear();
    this.#uiManager.removeLayer(this);
  }

  #cleanup() {
    // When we're cleaning up, some editors are removed but we don't want
    // to add a new one which will induce an addition in this.#editors, hence
    // an infinite loop.
    this.#isCleaningUp = true;

    const isHighlightMode = [
      AnnotationEditorType.HIGHLIGHT,
      AnnotationEditorType.UNDERLINE,
      AnnotationEditorType.STRIKEOUT,
    ].includes(this.#uiManager.getMode());

    if (isHighlightMode && this.#tempHighlight) {
      this.createAnnotationNode();
    }
    this.removeTempHighlight();
    for (const editor of this.#editors.values()) {
      if (editor.isEmpty()) {
        editor.remove();
      }
    }
    this.#isCleaningUp = false;
  }

  /**
   * Render the main editor.
   * @param {RenderEditorLayerOptions} parameters
   */
  render({ viewport }) {
    this.viewport = viewport;
    setLayerDimensions(this.div, viewport);
    for (const editor of this.#uiManager.getEditors(this.pageIndex)) {
      this.add(editor);
    }
    this.updateMode();
  }

  /**
   * Update the main editor.
   * @param {RenderEditorLayerOptions} parameters
   */
  update({ viewport, textLayer }) {
    // Editors have their dimensions/positions in percent so to avoid any
    // issues (see #15582), we must commit the current one before changing
    // the viewport.
    this.#uiManager.commitOrRemove();

    if (textLayer) {
      this.#textLayer = textLayer;
    }

    const oldRotation = this.viewport.rotation;
    const rotation = viewport.rotation;
    this.viewport = viewport;
    setLayerDimensions(this.div, { rotation });
    if (oldRotation !== rotation) {
      for (const editor of this.#editors.values()) {
        editor.rotate(rotation);
      }
    }
    this.updateMode();
  }

  /**
   * Get page dimensions.
   * @returns {Object} dimensions.
   */
  get pageDimensions() {
    const { pageWidth, pageHeight } = this.viewport.rawDims;
    return [pageWidth, pageHeight];
  }
}

export { AnnotationEditorLayer };

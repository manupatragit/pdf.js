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
/** @typedef {import("./annotation_editor_layer.js").AnnotationEditorLayer} AnnotationEditorLayer */

import {
  AnnotationEditorParamsType,
  AnnotationEditorType,
  shadow,
  Util,
} from "../../shared/util.js";
import {
  AnnotationEditorUIManager,
  bindEvents,
  KeyboardManager,
} from "./tools.js";
import { AnnotationEditor } from "./editor.js";
import { FreeTextAnnotationElement } from "../annotation_layer.js";

/**
 * Text editor in order to create a Text annotation.
 */
class TextEditor extends AnnotationEditor {
  #apiData = null;

  #boundEditorDivBlur = this.editorDivBlur.bind(this);

  #boundEditorDivFocus = this.editorDivFocus.bind(this);

  #boundEditorDivKeydown = this.editorDivKeydown.bind(this);

  #boundToggleNoteAppearance = this.toggleNoteAppearance.bind(this);

  #color;

  #content = "";

  #editorDivId = `${this.id}-editor`;

  #initialData = null;

  #isCollapsed = false;

  #smallNoteDiv = null;

  #largeNoteDiv = null;

  #actionBarDiv = null;

  static _defaultColor = "#97CCF6";

  static get _keyboardManager() {
    const proto = TextEditor.prototype;

    const arrowChecker = self => self.isEmpty();

    const small = AnnotationEditorUIManager.TRANSLATE_SMALL;
    const big = AnnotationEditorUIManager.TRANSLATE_BIG;

    return shadow(
      this,
      "_keyboardManager",
      new KeyboardManager([
        [
          // Commit the text in case the user use ctrl+s to save the document.
          // The event must bubble in order to be caught by the viewer.
          // See bug 1831574.
          ["ctrl+s", "mac+meta+s", "ctrl+p", "mac+meta+p"],
          proto.commitOrRemove,
          { bubbles: true },
        ],
        [
          ["ctrl+Enter", "mac+meta+Enter", "Escape", "mac+Escape"],
          proto.commitOrRemove,
        ],
        [
          ["ArrowLeft", "mac+ArrowLeft"],
          proto._translateEmpty,
          { args: [-small, 0], checker: arrowChecker },
        ],
        [
          ["ctrl+ArrowLeft", "mac+shift+ArrowLeft"],
          proto._translateEmpty,
          { args: [-big, 0], checker: arrowChecker },
        ],
        [
          ["ArrowRight", "mac+ArrowRight"],
          proto._translateEmpty,
          { args: [small, 0], checker: arrowChecker },
        ],
        [
          ["ctrl+ArrowRight", "mac+shift+ArrowRight"],
          proto._translateEmpty,
          { args: [big, 0], checker: arrowChecker },
        ],
        [
          ["ArrowUp", "mac+ArrowUp"],
          proto._translateEmpty,
          { args: [0, -small], checker: arrowChecker },
        ],
        [
          ["ctrl+ArrowUp", "mac+shift+ArrowUp"],
          proto._translateEmpty,
          { args: [0, -big], checker: arrowChecker },
        ],
        [
          ["ArrowDown", "mac+ArrowDown"],
          proto._translateEmpty,
          { args: [0, small], checker: arrowChecker },
        ],
        [
          ["ctrl+ArrowDown", "mac+shift+ArrowDown"],
          proto._translateEmpty,
          { args: [0, big], checker: arrowChecker },
        ],
      ])
    );
  }

  static _type = "text";

  static _editorType = AnnotationEditorType.TEXT;

  constructor(params) {
    super({ ...params, name: "textEditor" });
    this.#color =
      params.color ||
      TextEditor._defaultColor ||
      AnnotationEditor._defaultLineColor;
    this.disableToolbar = true;
  }

  /** @inheritdoc */
  static initialize(l10n) {
    AnnotationEditor.initialize(l10n);
  }

  /** @inheritdoc */
  static updateDefaultParams(type, value) {
    switch (type) {
      case AnnotationEditorParamsType.TEXT_COLOR:
        TextEditor._defaultColor = value;
        break;
    }
  }

  /** @inheritdoc */
  updateParams(type, value) {
    switch (type) {
      case AnnotationEditorParamsType.TEXT_COLOR:
        this.#updateColor(value);
        break;
    }
  }

  get localParams() {
    return {
      [AnnotationEditorParamsType.TEXT_COLOR]: this.#color,
    };
  }

  /** @inheritdoc */
  static get defaultPropertiesToUpdate() {
    return [
      [
        AnnotationEditorParamsType.TEXT_COLOR,
        TextEditor._defaultColor || AnnotationEditor._defaultLineColor,
      ],
    ];
  }

  /** @inheritdoc */
  get propertiesToUpdate() {
    return [[AnnotationEditorParamsType.TEXT_COLOR, this.#color]];
  }

  /**
   * Update the color and make this action undoable.
   * @param {string} color
   */
  #updateColor(color) {
    if (color === this.#color) {
      return;
    }

    const savedColor = this.#color;
    this.addCommands({
      cmd: () => {
        this.#color =
          this.#largeNoteDiv.style.backgroundColor =
          this.#smallNoteDiv.style.color =
            color;
      },
      undo: () => {
        this.#color =
          this.#largeNoteDiv.style.backgroundColor =
          this.#smallNoteDiv.style.color =
            savedColor;
      },
      mustExec: true,
      type: AnnotationEditorParamsType.TEXT_COLOR,
      overwriteIfSameType: true,
      keepUndo: true,
    });
  }

  /**
   * Helper to translate the editor with the keyboard when it's empty.
   * @param {number} x in page units.
   * @param {number} y in page units.
   */
  _translateEmpty(x, y) {
    this._uiManager.translateSelectedEditors(x, y, /* noCommit = */ true);
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

    if (!this.isAttachedToDOM) {
      // At some point this editor was removed and we're rebuilting it,
      // hence we must add it to its parent.
      this.parent.add(this);
    }
  }

  /** @inheritdoc */
  enableEditMode() {
    if (this.isInEditMode()) {
      return;
    }
    this.#setEditorDimensions();
    this.parent.setEditingState(false);
    super.enableEditMode();
    this.editorDiv.contentEditable = true;
    this.div.removeAttribute("aria-activedescendant");
    this.editorDiv.addEventListener("keydown", this.#boundEditorDivKeydown);
    this.editorDiv.addEventListener("focus", this.#boundEditorDivFocus);
    this.editorDiv.addEventListener("blur", this.#boundEditorDivBlur);
  }

  /** @inheritdoc */
  disableEditMode() {
    if (!this.isInEditMode()) {
      return;
    }
    this.parent.setEditingState(true);
    super.disableEditMode();
    this.editorDiv.contentEditable = false;
    this.div.setAttribute("aria-activedescendant", this.#editorDivId);
    this.editorDiv.removeEventListener("keydown", this.#boundEditorDivKeydown);
    this.editorDiv.removeEventListener("focus", this.#boundEditorDivFocus);
    this.editorDiv.removeEventListener("blur", this.#boundEditorDivBlur);

    // On Chrome, the focus is given to <body> when contentEditable is set to
    // false, hence we focus the div.
    this.div.focus({
      preventScroll: true /* See issue #15744 */,
    });

    // In case the blur callback hasn't been called.
    this.isEditing = false;
  }

  #setSelectedOnHover = () => {
    // TODO: Fix: The selected element becomes the text layer and
    // keyboard manager gets confused
    this.parent.setSelected(this);
    this._isDraggable = true;
  };

  setupOverlayDragEvents() {
    this.overlayDiv.addEventListener("mouseover", this.#setSelectedOnHover);

    this.overlayDiv.addEventListener("mouseout", () => {
      this._isDraggable = false;
    });
  }

  /** @inheritdoc */
  focusin(event) {
    if (!this._focusEventsAllowed) {
      return;
    }
    super.focusin(event);
    if (event.target !== this.editorDiv) {
      this.editorDiv.focus();
    }
  }

  /** @inheritdoc */
  onceAdded() {
    this.#addMenuButton();

    if (this.wasAddedFromApi) {
      if (this.#apiData.collapsed && !this.#isCollapsed) {
        // We don't want to send an event when we are loading the
        // annotation from the API
        this.toggleNoteAppearance(/* emitEvent= */ false);
      }

      return;
    }

    if (this.width) {
      this.#cheatInitialRect();
      // The editor was created in using ctrl+c.
      return;
    }
    this.enableEditMode();
    this.editorDiv.focus();
    if (this._initialOptions?.isCentered) {
      this.center();
    }
    this._initialOptions = null;
  }

  /** @inheritdoc */
  isEmpty() {
    return !this.editorDiv;
  }

  /** @inheritdoc */
  remove() {
    this.isEditing = false;
    if (this.parent) {
      this.parent.setEditingState(true);
    }
    this.#removeMenuButton();
    super.remove();
  }

  /**
   * Extract the text from this editor.
   * @returns {string}
   */
  #extractText() {
    const buffer = [];
    this.editorDiv.childNodes.forEach(textNode => {
      try {
        const textContent = textNode.textContent.trim().replace(/\r\n?|\n/, "");
        buffer.push(textContent);
      } catch {}
    });
    return buffer.join("\n");
  }

  #setEditorDimensions() {
    const [parentWidth, parentHeight] = this.parentDimensions;
    let rect;
    if (this.isAttachedToDOM) {
      rect = this.div.getBoundingClientRect();
    } else {
      // This editor isn't on screen but we need to get its dimensions, so
      // we just insert it in the DOM, get its bounding box and then remove it.
      const { currentLayer, div } = this;
      const savedDisplay = div.style.display;
      div.style.display = "hidden";
      currentLayer.div.append(this.div);
      rect = div.getBoundingClientRect();
      div.remove();
      div.style.display = savedDisplay;
    }

    // The dimensions are relative to the rotation of the page, hence we need to
    // take that into account (see issue #16636).
    if (this.rotation % 180 === this.parentRotation % 180) {
      this.width = rect.width / parentWidth;
      this.height = rect.height / parentHeight;
    } else {
      this.width = rect.height / parentWidth;
      this.height = rect.width / parentHeight;
    }

    this.fixAndSetPosition();
  }

  /**
   * Commit the content we have in this editor.
   * @returns {undefined}
   */
  commit() {
    if (!this.isInEditMode()) {
      return;
    }

    super.commit();
    this.disableEditMode();
    const savedText = this.#content;
    const newText = (this.#content = this.#extractText().trimEnd());
    if (savedText === newText) {
      return;
    }

    this.#setEditorDimensions();
    const setText = text => {
      this.#content = text;
      if (!text) {
        this.remove();
        return;
      }
      this.#setContent();
      this._uiManager.rebuild(this);
      this.#setEditorDimensions();
    };
    this.addCommands({
      cmd: () => {
        setText(newText);
      },
      undo: () => {
        setText(savedText);
      },
      mustExec: false,
    });
  }

  /** @inheritdoc */
  shouldGetKeyboardEvents() {
    return this.isInEditMode();
  }

  /** @inheritdoc */
  enterInEditMode() {
    this.enableEditMode();
    this.editorDiv.focus();
  }

  openOrEdit() {
    if (this.#smallNoteDiv.classList.contains("show")) {
      this.toggleNoteAppearance();
    } else {
      this.enterInEditMode();
    }
  }

  pointerup() {
    if (this.isEditing || this._wasDragged) {
      return;
    }
    this.openOrEdit();
  }

  /**
   * onkeydown callback.
   * @param {KeyboardEvent} event
   */
  keydown(event) {
    if (event.target === this.div && event.key === "Enter") {
      this.enterInEditMode();
      // Avoid to add an unwanted new line.
      event.preventDefault();
    }
  }

  editorDivKeydown(event) {
    TextEditor._keyboardManager.exec(this, event);
  }

  editorDivFocus(event) {
    this.isEditing = true;
  }

  editorDivBlur(event) {
    this.isEditing = false;
  }

  /** @inheritdoc */
  disableEditing() {
    this.editorDiv.setAttribute("role", "comment");
    this.editorDiv.removeAttribute("aria-multiline");
  }

  /** @inheritdoc */
  enableEditing() {
    this.editorDiv.setAttribute("role", "textbox");
    this.editorDiv.setAttribute("aria-multiline", true);
  }

  toggleNoteAppearance(emitEvent = true) {
    const toggleCommand = () => {
      this.#isCollapsed = !this.#isCollapsed;

      this.#smallNoteDiv.classList.toggle("show");
      this.#largeNoteDiv.classList.toggle("show");

      /**
       * Give user illusion that top right corner is fixed when internally
       * it's the top left corner that is fixed
       *
       * When sticky note is closed: Move small note in the right direction
       * The user's mouse will have to travel the shortest distance to interact
       * with the collapsed note
       *
       * When sticky note is opened: Move large note in the left left direction
       * The user's mouse will have to travel the shortest distance to interact
       * with the actions menu of the opened note
       *
       */

      const [parentWidth, parentHeight] = this.parentDimensions;

      // TODO: Make sizes dynamic after resizing is added
      let realWidthInPx = 268,
        realHeightInPx = 172;
      if (this.#isCollapsed) {
        realHeightInPx = realWidthInPx = 25;
      }
      const newWidth = realWidthInPx / parentWidth;
      const newHeight = realHeightInPx / parentHeight;

      if (this.#isCollapsed) {
        this.x += this.width - newWidth;
      } else {
        this.x -= newWidth - this.width;
      }

      this.width = newWidth;
      this.height = newHeight;

      this.fixAndSetPosition();
    };

    if (emitEvent) {
      this.addCommands({
        cmd: toggleCommand,
        undo: toggleCommand,
        mustExec: true,
      });
    } else {
      toggleCommand();
    }
  }

  createCollapsedNote() {
    const smallNote = document.createElement("div");
    smallNote.className = "sticky-note-small";
    smallNote.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"> <path d="M64 32C28.7 32 0 60.7 0 96V416c0 35.3 28.7 64 64 64H288V368c0-26.5 21.5-48 48-48H448V96c0-35.3-28.7-64-64-64H64zM448 352H402.7 336c-8.8 0-16 7.2-16 16v66.7V480l32-32 64-64 32-32z" fill="currentColor"/> </svg>';
    smallNote.style.color = this.#color;
    this.#smallNoteDiv = smallNote;
    smallNote.addEventListener("click", this.#boundToggleNoteAppearance);
    this.div.append(smallNote);
  }

  createActionBar() {
    const actionBar = document.createElement("div");
    actionBar.className = "sticky-note-action-bar";

    this.#actionBarDiv = actionBar;
    return actionBar;
  }

  #addMenuButton() {
    const onHideNote = () => {
      this.#boundToggleNoteAppearance();
    };

    const onDelete = () => {
      this._uiManager.delete();
    };

    const getText = () => {
      return this.#extractText();
    };

    const props = {
      getText,
      onHideNote,
      onDelete,
      onOpen: this.#setSelectedOnHover,
    };

    this._uiManager.addStickyNoteMenuButton({
      id: `${this.id}-stickyNoteMenuButton`,
      editor: this,
      props,
      div: this.#actionBarDiv,
    });
  }

  #removeMenuButton() {
    this._uiManager.removeExternalElement({
      id: `${this.id}-stickyNoteMenuButton`,
    });
  }

  /** @inheritdoc */
  render() {
    if (this.div) {
      return this.div;
    }

    let baseX, baseY;
    if (this.width) {
      baseX = this.x;
      baseY = this.y;
    }

    super.render();
    this.createCollapsedNote();
    const largeNoteDiv = document.createElement("div");
    largeNoteDiv.className = "sticky-note-large show";
    this.#largeNoteDiv = largeNoteDiv;
    this.#largeNoteDiv.style.backgroundColor = this.#color;

    const actionBarDiv = this.createActionBar();
    largeNoteDiv.append(actionBarDiv);

    this.editorDiv = document.createElement("div");
    this.editorDiv.className = "internal";

    this.editorDiv.setAttribute("id", this.#editorDivId);
    this.editorDiv.setAttribute("data-l10n-id", "pdfjs-text");
    this.enableEditing();

    this.editorDiv?.setAttribute("default-content", "Start typing");
    this.editorDiv.contentEditable = true;

    largeNoteDiv.append(this.editorDiv);
    this.div.append(largeNoteDiv);

    this.overlayDiv = document.createElement("div");
    this.overlayDiv.classList.add("overlay", "enabled");
    this.setupOverlayDragEvents();
    this.div.append(this.overlayDiv);

    // The goal is to sanitize and have something suitable for this
    // editor.
    bindEvents(this, this.div, ["keydown", "pointerup"]);

    if (this.width) {
      // This editor was created in using copy (ctrl+c).
      const [parentWidth, parentHeight] = this.parentDimensions;
      if (this.annotationElementId) {
        // position is the position of the first glyph in the annotation
        // and it's relative to its container.
        const { position } = this.#initialData;
        let [tx, ty] = this.getInitialTranslation();
        [tx, ty] = this.pageTranslationToScreen(tx, ty);
        const [pageWidth, pageHeight] = this.pageDimensions;
        const [pageX, pageY] = this.pageTranslation;
        let posX, posY;
        switch (this.rotation) {
          case 0:
            posX = baseX + (position[0] - pageX) / pageWidth;
            posY = baseY + this.height - (position[1] - pageY) / pageHeight;
            break;
          case 90:
            posX = baseX + (position[0] - pageX) / pageWidth;
            posY = baseY - (position[1] - pageY) / pageHeight;
            [tx, ty] = [ty, -tx];
            break;
          case 180:
            posX = baseX - this.width + (position[0] - pageX) / pageWidth;
            posY = baseY - (position[1] - pageY) / pageHeight;
            [tx, ty] = [-tx, -ty];
            break;
          case 270:
            posX =
              baseX +
              (position[0] - pageX - this.height * pageHeight) / pageWidth;
            posY =
              baseY +
              (position[1] - pageY - this.width * pageWidth) / pageHeight;
            [tx, ty] = [-ty, tx];
            break;
        }
        this.setAt(posX * parentWidth, posY * parentHeight, tx, ty);
      } else if (this.wasAddedFromApi) {
        // TODO: Confirm if this is the correct way to deal with shifts
        this.setAt(baseX * parentWidth, baseY * parentHeight, 0, 0);
      } else {
        this.setAt(
          baseX * parentWidth,
          baseY * parentHeight,
          this.width * parentWidth,
          this.height * parentHeight
        );
      }

      this.#setContent();
      this._isDraggable = true;
      this.editorDiv.contentEditable = false;
    } else {
      this._isDraggable = false;
      this.editorDiv.contentEditable = true;
    }

    if (typeof PDFJSDev !== "undefined" && PDFJSDev.test("TESTING")) {
      this.div.setAttribute("annotation-id", this.annotationElementId);
    }

    return this.div;
  }

  #setContent() {
    this.editorDiv.replaceChildren();
    if (!this.#content) {
      return;
    }
    for (const line of this.#content.split("\n")) {
      const div = document.createElement("div");
      div.append(
        line ? document.createTextNode(line) : document.createElement("br")
      );
      this.editorDiv.append(div);
    }
  }

  /** @inheritdoc */
  get contentDiv() {
    return this.editorDiv;
  }

  /** @inheritdoc */
  static deserialize(data, parent, uiManager) {
    // TODO: Confirm implementation
    let initialData = null;
    if (data instanceof FreeTextAnnotationElement) {
      const {
        data: { rect, rotation, id },
        textContent,
        textPosition,
        parent: {
          page: { pageNumber },
        },
      } = data;
      // textContent is supposed to be an array of strings containing each line
      // of text. However, it can be null or empty.
      if (!textContent || textContent.length === 0) {
        // Empty annotation.
        return null;
      }
      initialData = data = {
        annotationType: AnnotationEditorType.TEXT,
        value: textContent.join("\n"),
        position: textPosition,
        pageIndex: pageNumber - 1,
        rect,
        rotation,
        id,
        deleted: false,
      };
    }
    const editor = super.deserialize(data, parent, uiManager);

    editor.#color = Util.makeHexColor(...data.color);
    editor.#content = data.value;
    editor.annotationElementId = data.id || null;
    editor.#initialData = initialData;

    return editor;
  }

  /** @inheritdoc */
  serialize(isForCopying = false) {
    if (this.isEmpty()) {
      return null;
    }

    if (this.deleted) {
      return {
        pageIndex: this.pageIndex,
        id: this.annotationElementId,
        deleted: true,
      };
    }

    const rect = this.getRect(0, 0);
    const color = AnnotationEditor._colorManager.convert(
      this.isAttachedToDOM
        ? getComputedStyle(this.editorDiv).color
        : this.#color
    );

    const serialized = {
      annotationType: AnnotationEditorType.TEXT,
      color,
      content: this.#content,
      pageIndex: this.pageIndex,
      rect,
      rotation: this.rotation,
      structTreeParentId: this._structTreeParentId,
    };

    if (isForCopying) {
      // Don't add the id when copying because the pasted editor mustn't be
      // linked to an existing annotation.
      return serialized;
    }

    if (this.annotationElementId && !this.#hasElementChanged(serialized)) {
      return null;
    }

    serialized.id = this.annotationElementId;

    return serialized;
  }

  serializeToJSON() {
    if (this.isEmpty()) {
      return null;
    }

    const rect = this.getRect(0, 0);

    return {
      annotationType: AnnotationEditorType.TEXT,
      color: this.#color,
      text: this.#content,
      pageIndex: this.pageIndex,
      rect,
      rotation: this.rotation,
      collapsed: this.#isCollapsed,
    };
  }

  static deserializeFromJSON(data, parent, uiManager) {
    const editor = super.deserialize(data, parent, uiManager);

    editor.#color = data.color;
    editor.#content = data.text || null;

    editor.wasAddedFromApi = true;
    editor.#apiData = data;

    return editor;
  }

  #hasElementChanged(serialized) {
    const { value, color, rect, pageIndex } = this.#initialData;

    return (
      serialized.value !== value ||
      serialized.rect.some((x, i) => Math.abs(x - rect[i]) >= 1) ||
      serialized.color.some((c, i) => c !== color[i]) ||
      serialized.pageIndex !== pageIndex
    );
  }

  #cheatInitialRect(delayed = false) {
    // The annotation has a rect but the editor has an other one.
    // When we want to know if the annotation has changed (e.g. has been moved)
    // we must compare the editor initial rect with the current one.
    // So this method is a hack to have a way to compare the real rects.
    if (!this.annotationElementId) {
      return;
    }

    this.#setEditorDimensions();
    if (!delayed && (this.width === 0 || this.height === 0)) {
      setTimeout(() => this.#cheatInitialRect(/* delayed = */ true), 0);
      return;
    }

    this.#initialData.rect = this.getRect(0, 0);
  }
}

export { TextEditor };

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

import {
  AnnotationEditorParamsType,
  AnnotationEditorType,
  Util,
} from "../../shared/util.js";
import { AnnotationEditor } from "./editor.js";
import { noContextMenu } from "../display_utils.js";
import { opacityToHex } from "./tools.js";

/**
 * Basic draw editor in order to generate an Square annotation.
 */
class SquareEditor extends AnnotationEditor {
  #baseHeight = 0;

  #baseWidth = 0;

  #boundCanvasPointermove = this.canvasPointermove.bind(this);

  #boundCanvasPointerleave = this.canvasPointerleave.bind(this);

  #boundCanvasPointerup = this.canvasPointerup.bind(this);

  #boundCanvasPointerdown = this.canvasPointerdown.bind(this);

  #canvasContextMenuTimeoutId = null;

  #disableEditing = false;

  #hasSomethingNewToDraw = false;

  #isCanvasInitialized = false;

  #observer = null;

  #realWidth = 0;

  #realHeight = 0;

  #requestFrameCallback = null;

  static _defaultColor = "#F7CE46";

  static _defaultOpacity = 0.3;

  static _type = "square";

  static _editorType = AnnotationEditorType.SQUARE;

  // TODO: Fix 3 annotations being created instead of 1
  constructor(params) {
    super({ ...params, name: "squareEditor" });
    this.color = params.color || null;
    this.opacity = params.opacity || null;
    this.scaleFactorW = 1;
    this.scaleFactorH = 1;
    this.translationX = this.translationY = 0;
    this.x = 0;
    this.y = 0;
    this._willKeepAspectRatio = false;
    this.rect = {};
  }

  /** @inheritdoc */
  static initialize(l10n) {
    AnnotationEditor.initialize(l10n);
  }

  /** @inheritdoc */
  static updateDefaultParams(type, value) {
    switch (type) {
      case AnnotationEditorParamsType.SQUARE_COLOR:
        SquareEditor._defaultColor = value;
        break;
      case AnnotationEditorParamsType.SQUARE_OPACITY:
        SquareEditor._defaultOpacity = value / 100;
        break;
    }
  }

  /** @inheritdoc */
  updateParams(type, value) {
    switch (type) {
      case AnnotationEditorParamsType.SQUARE_COLOR:
        this.#updateColor(value);
        break;
      case AnnotationEditorParamsType.SQUARE_OPACITY:
        this.#updateOpacity(value);
        break;
    }
  }

  get localParams() {
    return {
      [AnnotationEditorParamsType.SQUARE_COLOR]: this.color,
      [AnnotationEditorParamsType.SQUARE_OPACITY]: this.opacity * 100,
    };
  }

  /** @inheritdoc */
  static get defaultPropertiesToUpdate() {
    return [
      [
        AnnotationEditorParamsType.SQUARE_COLOR,
        SquareEditor._defaultColor || AnnotationEditor._defaultLineColor,
      ],
      [
        AnnotationEditorParamsType.SQUARE_OPACITY,
        Math.round(SquareEditor._defaultOpacity * 100),
      ],
    ];
  }

  /** @inheritdoc */
  get propertiesToUpdate() {
    return [
      [
        AnnotationEditorParamsType.SQUARE_COLOR,
        this.color ||
          SquareEditor._defaultColor ||
          AnnotationEditor._defaultLineColor,
      ],
      [
        AnnotationEditorParamsType.SQUARE_OPACITY,
        Math.round(100 * (this.opacity ?? SquareEditor._defaultOpacity)),
      ],
    ];
  }

  /**
   * Update the color and make this action undoable.
   * @param {string} color
   */
  #updateColor(color) {
    if (color === this.color) {
      return;
    }

    const savedColor = this.color;
    this.addCommands({
      cmd: () => {
        this.color = color;
        this.#redraw();
      },
      undo: () => {
        this.color = savedColor;
        this.#redraw();
      },
      mustExec: true,
      type: AnnotationEditorParamsType.SQUARE_COLOR,
      overwriteIfSameType: true,
      keepUndo: true,
    });
  }

  /**
   * Update the opacity and make this action undoable.
   * @param {number} opacity
   */
  #updateOpacity(opacity) {
    opacity /= 100;

    if (opacity === this.opacity) {
      return;
    }

    const savedOpacity = this.opacity;
    this.addCommands({
      cmd: () => {
        this.opacity = opacity;
        this.#redraw();
      },
      undo: () => {
        this.opacity = savedOpacity;
        this.#redraw();
      },
      mustExec: true,
      type: AnnotationEditorParamsType.SQUARE_OPACITY,
      overwriteIfSameType: true,
      keepUndo: true,
    });
  }

  async addEditToolbar() {
    const props = {
      onColorSelect: this.#updateColor.bind(this),
      onOpacitySelect: this.#updateOpacity.bind(this),
      initialColor: this.color,
      initialOpacity: this.opacity * 100,
    };

    const toolbar = await super.addEditToolbar(props);
    if (!toolbar) {
      return null;
    }

    return toolbar;
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

    if (!this.canvas) {
      this.#createCanvas();
      this.#createObserver();
    }

    if (!this.isAttachedToDOM) {
      // At some point this editor was removed and we're rebuilding it,
      // hence we must add it to its parent.
      this.parent.add(this);
      this.#setCanvasDimensions();
    }

    this.#fitToContent();
  }

  /** @inheritdoc */
  remove() {
    if (this.canvas === null) {
      return;
    }

    if (!this.isEmpty()) {
      this.commit();
    }

    // Destroy the canvas.
    this.canvas.width = this.canvas.height = 0;
    this.canvas.remove();
    this.canvas = null;

    if (this.#canvasContextMenuTimeoutId) {
      clearTimeout(this.#canvasContextMenuTimeoutId);
      this.#canvasContextMenuTimeoutId = null;
    }

    this.#observer.disconnect();
    this.#observer = null;

    super.remove();
  }

  setParent(parent) {
    if (!this.parent && parent) {
      // We've a parent hence the rescale will be handled thanks to the
      // ResizeObserver.
      this._uiManager.removeShouldRescale(this);
    } else if (this.parent && parent === null) {
      // The editor is removed from the DOM, hence we handle the rescale thanks
      // to the onScaleChanging callback.
      // This way, it'll be saved/printed correctly.
      this._uiManager.addShouldRescale(this);
    }
    super.setParent(parent);
  }

  onScaleChanging() {
    const [parentWidth, parentHeight] = this.parentDimensions;
    const width = this.width * parentWidth;
    const height = this.height * parentHeight;
    this.setDimensions(width, height);
  }

  /** @inheritdoc */
  enableEditMode() {
    if (this.#disableEditing || this.canvas === null) {
      return;
    }

    super.enableEditMode();
    this._isDraggable = false;
    this.canvas.addEventListener("pointerdown", this.#boundCanvasPointerdown);
  }

  /** @inheritdoc */
  disableEditMode() {
    if (!this.isInEditMode() || this.canvas === null) {
      return;
    }

    super.disableEditMode();
    this._isDraggable = !this.isEmpty();
    this.div.classList.remove("editing");

    this.canvas.removeEventListener(
      "pointerdown",
      this.#boundCanvasPointerdown
    );
  }

  /** @inheritdoc */
  onceAdded() {
    if (this.wasAddedFromApi) {
      // If this is not set to true, fitToContent will not resize the canvas
      // and drag events will not work
      this.#disableEditing = true;
      this.rebuild();
    }

    this._isDraggable = this.#isDrawn();
  }

  #isDrawn() {
    const rectExists = Boolean(this.rect);
    const coordsExist =
      rectExists &&
      ![
        this.rect.startX,
        this.rect.startY,
        this.rect.endX,
        this.rect.endY,
      ].includes(undefined);

    return coordsExist;
  }

  /** @inheritdoc */
  isEmpty() {
    const hasCorrectCoords =
      this.#isDrawn() &&
      Math.abs(this.rect.endX - this.rect.startX) > 0 &&
      Math.abs(this.rect.endY - this.rect.startY) > 0;

    return !hasCorrectCoords;
  }

  /**
   * Set rect styles.
   */
  #setSquareStyles() {
    const { ctx, color, opacity } = this;
    ctx.fillStyle = `${color}${opacityToHex(opacity)}`;
  }

  /**
   * Start to draw on the canvas.
   * @param {number} x
   * @param {number} y
   */
  #startDrawing(x, y) {
    this.canvas.addEventListener("contextmenu", noContextMenu);
    this.canvas.addEventListener("pointerleave", this.#boundCanvasPointerleave);
    this.canvas.addEventListener("pointermove", this.#boundCanvasPointermove);
    this.canvas.addEventListener("pointerup", this.#boundCanvasPointerup);
    this.canvas.removeEventListener(
      "pointerdown",
      this.#boundCanvasPointerdown
    );

    this.isEditing = true;
    if (!this.#isCanvasInitialized) {
      this.#isCanvasInitialized = true;
      this.#setCanvasDimensions();
      this.color ||=
        SquareEditor._defaultColor || AnnotationEditor._defaultLineColor;
      this.opacity ??= SquareEditor._defaultOpacity;
    }
    this.rect = {
      startX: x,
      startY: y,
      endX: x,
      endY: y,
    };
    this.#hasSomethingNewToDraw = false;
    this.#setSquareStyles();

    this.#requestFrameCallback = () => {
      this.#updateRect();
      if (this.#requestFrameCallback) {
        window.requestAnimationFrame(this.#requestFrameCallback);
      }
    };
    window.requestAnimationFrame(this.#requestFrameCallback);
  }

  /**
   * Draw on the canvas.
   * @param {number} x
   * @param {number} y
   */
  #drawRect(x, y) {
    // TODO: Early return

    this.rect.endX = x;
    this.rect.endY = y;
    this.#hasSomethingNewToDraw = true;
  }

  /**
   * Stop to draw on the canvas.
   * @param {number} x
   * @param {number} y
   */
  #stopDrawing(x, y) {
    this.#requestFrameCallback = null;

    x = Math.min(Math.max(x, 0), this.canvas.width);
    y = Math.min(Math.max(y, 0), this.canvas.height);

    this.#drawRect(x, y);
    const newRect = this.rect;
    const oldRect = this.prevRect;

    const setRect = rect => {
      this.rect = rect;
      if (!rect) {
        this.remove();
        return;
      }
      this.rebuild();
    };

    const cmd = () => {
      setRect(newRect);
    };

    const undo = () => {
      setRect(oldRect);
    };

    cmd();
    return { cmd, undo, removesOnUndo: !oldRect };
  }

  #updateRect() {
    if (!this.#hasSomethingNewToDraw) {
      return;
    }
    this.#hasSomethingNewToDraw = false;

    const { ctx } = this;
    ctx.save();

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillRect(
      this.rect.startX,
      this.rect.startY,
      this.rect.endX - this.rect.startX,
      this.rect.endY - this.rect.startY
    );
  }

  /**
   * Redraw the rect
   */
  #redraw() {
    if (this.isEmpty()) {
      this.#scaleCanvasContent();
      return;
    }
    this.#hasSomethingNewToDraw = false;
    this.#setSquareStyles();

    const { canvas, ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.#scaleCanvasContent();

    ctx.fillRect(
      this.rect.startX,
      this.rect.startY,
      this.rect.endX - this.rect.startX,
      this.rect.endY - this.rect.startY
    );
  }

  /**
   * Commit the rectangle we have in this editor.
   */
  commit() {
    if (this.#disableEditing) {
      return;
    }

    super.commit();

    this.isEditing = false;
    this.disableEditMode();

    // This editor must be on top of the main square editor.
    this.setInForeground();

    // TODO: Remove this since we always allow editing
    // It changes #fitToContent behavior
    this.#disableEditing = true;

    this.#fitToContent(/* firstTime = */ true);
    this.select();

    // When commiting, the position of this editor is changed, hence we must
    // move it to the right position in the DOM.
    this.moveInDOM();
    this.div.focus({
      preventScroll: true /* See issue #15744 */,
    });

    this.parent.resetAnnotationMode();
  }

  /** @inheritdoc */
  focusin(event) {
    if (!this._focusEventsAllowed) {
      return;
    }
    super.focusin(event);
    this.enableEditMode();
  }

  /**
   * onpointerdown callback for the canvas we're drawing on.
   * @param {PointerEvent} event
   */
  canvasPointerdown(event) {
    if (event.button !== 0 || !this.isInEditMode() || this.#disableEditing) {
      return;
    }

    // We want to draw on top of any other editors.
    // Since it's the last child, there's no need to give it a higher z-index.
    this.setInForeground();

    event.preventDefault();

    if (!this.div.contains(document.activeElement)) {
      this.div.focus({
        preventScroll: true /* See issue #17327 */,
      });
    }

    this.#startDrawing(event.offsetX, event.offsetY);
  }

  /**
   * onpointermove callback for the canvas we're drawing on.
   * @param {PointerEvent} event
   */
  canvasPointermove(event) {
    event.preventDefault();
    this.#drawRect(event.offsetX, event.offsetY);
  }

  /**
   * onpointerup callback for the canvas we're drawing on.
   * @param {PointerEvent} event
   */
  canvasPointerup(event) {
    event.preventDefault();
    this.#handleFinalDrawEvent(event);
  }

  /**
   * onpointerleave callback for the canvas we're drawing on.
   * @param {PointerEvent} event
   */
  canvasPointerleave(event) {
    this.#handleFinalDrawEvent(event);
  }

  /**
   * End the drawing.
   * @param {PointerEvent} event
   */
  #handleFinalDrawEvent(event) {
    this.canvas.removeEventListener(
      "pointerleave",
      this.#boundCanvasPointerleave
    );
    this.canvas.removeEventListener(
      "pointermove",
      this.#boundCanvasPointermove
    );
    this.canvas.removeEventListener("pointerup", this.#boundCanvasPointerup);
    this.canvas.addEventListener("pointerdown", this.#boundCanvasPointerdown);

    // Slight delay to avoid the context menu to appear (it can happen on a long
    // tap with a pen).
    if (this.#canvasContextMenuTimeoutId) {
      clearTimeout(this.#canvasContextMenuTimeoutId);
    }
    this.#canvasContextMenuTimeoutId = setTimeout(() => {
      this.#canvasContextMenuTimeoutId = null;
      this.canvas.removeEventListener("contextmenu", noContextMenu);
    }, 10);

    const { cmd, undo, removesOnUndo } = this.#stopDrawing(
      event.offsetX,
      event.offsetY
    );

    this.addToAnnotationStorage();

    // Since the square editor covers all of the page and we want to be able
    // to select another editor, we just put this one in the background.
    this.setInBackground();
    this.commit();

    // TODO: Commands are being added after commit to make sure the correct
    // getRect values get passed to the API. Find a better way to do it
    this.addCommands({ cmd, undo, mustExec: false, removesOnUndo });
  }

  /**
   * Create the canvas element.
   */
  #createCanvas() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.canvas.height = 0;
    this.canvas.className = "squareEditorCanvas";
    this.canvas.setAttribute("data-l10n-id", "pdfjs-square-canvas");

    this.div.append(this.canvas);
    this.ctx = this.canvas.getContext("2d");
  }

  /**
   * Create the resize observer.
   */
  #createObserver() {
    this.#observer = new ResizeObserver(entries => {
      const rect = entries[0].contentRect;
      if (rect.width && rect.height) {
        this.setDimensions(rect.width, rect.height);
      }
    });
    this.#observer.observe(this.div);
  }

  /** @inheritdoc */
  get isResizable() {
    return !this.isEmpty() && this.#disableEditing;
  }

  #getInitialBindingBox() {
    const {
      parentRotation,
      parentDimensions: [width, height],
    } = this;
    switch (parentRotation) {
      case 90:
        return [0, height, height, width];
      case 180:
        return [width, height, width, height];
      case 270:
        return [width, 0, height, width];
      default:
        return [0, 0, width, height];
    }
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

    this.div.setAttribute("data-l10n-id", "pdfjs-square");

    const [x, y, w, h] = this.#getInitialBindingBox();
    this.setAt(x, y, 0, 0);
    this.setDims(w, h);

    this.#createCanvas();

    if (this.width) {
      // This editor was created in using copy (ctrl+c).
      const [parentWidth, parentHeight] = this.parentDimensions;
      this.setAt(baseX * parentWidth, baseY * parentHeight, 0, 0);
      this.#isCanvasInitialized = true;
      this.#setCanvasDimensions();
      this.setDims(this.width * parentWidth, this.height * parentHeight);
      this.#redraw();
      this.div.classList.add("disabled");
    } else {
      this.div.classList.add("editing");
      this.enableEditMode();
    }

    this.#createObserver();

    return this.div;
  }

  #setCanvasDimensions() {
    if (!this.#isCanvasInitialized) {
      return;
    }
    const [parentWidth, parentHeight] = this.parentDimensions;
    this.canvas.width = Math.ceil(this.width * parentWidth);
    this.canvas.height = Math.ceil(this.height * parentHeight);
    this.#scaleCanvasContent();
  }

  /**
   * When the dimensions of the div change the inner canvas must
   * renew its dimensions, hence it must redraw its own contents.
   * @param {number} width - the new width of the div
   * @param {number} height - the new height of the div
   * @returns
   */
  setDimensions(width, height) {
    const roundedWidth = Math.round(width);
    const roundedHeight = Math.round(height);
    if (
      this.#realWidth === roundedWidth &&
      this.#realHeight === roundedHeight
    ) {
      return;
    }

    this.#realWidth = roundedWidth;
    this.#realHeight = roundedHeight;

    this.canvas.style.visibility = "hidden";

    const [parentWidth, parentHeight] = this.parentDimensions;
    this.width = width / parentWidth;
    this.height = height / parentHeight;
    this.fixAndSetPosition();

    if (this.#disableEditing) {
      this.#setScaleFactor(width, height);
    }

    this.#setCanvasDimensions();
    this.#redraw();

    this.canvas.style.visibility = "visible";

    // For any reason the dimensions couldn't be in percent but in pixels, hence
    // we must fix them.
    this.fixDims();
  }

  #setScaleFactor(width, height) {
    this.scaleFactorW = width / this.#baseWidth;
    this.scaleFactorH = height / this.#baseHeight;
  }

  /**
   * Update the canvas transform.
   */
  #scaleCanvasContent() {
    this.ctx.setTransform(
      this.scaleFactorW,
      0,
      0,
      this.scaleFactorH,
      this.translationX * this.scaleFactorW,
      this.translationY * this.scaleFactorH
    );
  }

  /**
   * Get the bounding box containing the square.
   * @returns {Array<number>}
   */
  #getBoundingBox() {
    const xMin = Math.min(this.rect.startX, this.rect.endX);
    const xMax = Math.max(this.rect.startX, this.rect.endX);
    const yMin = Math.min(this.rect.startY, this.rect.endY);
    const yMax = Math.max(this.rect.startY, this.rect.endY);

    return [xMin, yMin, xMax, yMax];
  }

  /**
   * Set the div position and dimensions in order to fit to
   * the bounding box of the contents.
   * @returns {undefined}
   */
  #fitToContent() {
    if (this.isEmpty()) {
      return;
    }

    if (!this.#disableEditing) {
      this.#redraw();
      return;
    }

    const bbox = this.#getBoundingBox();
    this.#baseWidth = Math.max(AnnotationEditor.MIN_SIZE, bbox[2] - bbox[0]);
    this.#baseHeight = Math.max(AnnotationEditor.MIN_SIZE, bbox[3] - bbox[1]);

    const width = Math.ceil(this.#baseWidth * this.scaleFactorW);
    const height = Math.ceil(this.#baseHeight * this.scaleFactorH);

    const [parentWidth, parentHeight] = this.parentDimensions;
    this.width = width / parentWidth;
    this.height = height / parentHeight;

    const prevTranslationX = this.translationX;
    const prevTranslationY = this.translationY;

    this.translationX = -bbox[0];
    this.translationY = -bbox[1];
    this.#setCanvasDimensions();
    this.#redraw();

    this.#realWidth = width;
    this.#realHeight = height;

    this.setDims(width, height);
    this.translate(
      prevTranslationX - this.translationX,
      prevTranslationY - this.translationY
    );
  }

  deserializeNoZoomDimension(noZoomValue) {
    const zoomedValue = noZoomValue * this.parentScale;
    return zoomedValue;
  }

  #getSerializedRect() {
    const [pageWidth, pageHeight] = this.pageDimensions;
    const startX = this.x * pageWidth;
    const startY = this.y * pageHeight;
    const width = this.width * pageWidth;
    const height = this.height * pageHeight;

    return { startX, startY, endX: startX + width, endY: startY + height };
  }

  getDeserializedRect(serializedRect) {
    const { startX, startY, endX, endY } = serializedRect;

    const result = {
      startX: this.deserializeNoZoomDimension(startX || 0),
      startY: this.deserializeNoZoomDimension(startY || 0),
      endX: this.deserializeNoZoomDimension(endX || 0),
      endY: this.deserializeNoZoomDimension(endY || 0),
    };

    return result;
  }

  /** @inheritdoc */
  static deserialize(data, parent, uiManager) {
    const editor = super.deserialize(data, parent, uiManager);

    editor.color = Util.makeHexColor(...data.color);
    editor.opacity = data.opacity;

    const [pageWidth, pageHeight] = editor.pageDimensions;
    const width = editor.width * pageWidth;
    const height = editor.height * pageHeight;

    editor.#disableEditing = true;
    editor.#realWidth = Math.round(width);
    editor.#realHeight = Math.round(height);

    editor.#baseWidth = Math.max(AnnotationEditor.MIN_SIZE);
    editor.#baseHeight = Math.max(AnnotationEditor.MIN_SIZE);

    return editor;
  }

  /** @inheritdoc */
  serialize() {
    // TODO: Fix this workaround
    if (this.isEmpty() || !this.color) {
      return null;
    }

    const rect = this.getRect(0, 0);
    const color = AnnotationEditor._colorManager.convert(this.color);

    return {
      annotationType: AnnotationEditorType.SQUARE,
      color,
      opacity: this.opacity,
      pageIndex: this.pageIndex,
      rect,
      rotation: this.rotation,
      structTreeParentId: this._structTreeParentId,
    };
  }

  serializeToJSON() {
    if (this.isEmpty()) {
      return null;
    }

    const rect = this.getRect(0, 0);

    return {
      annotationType: AnnotationEditorType.SQUARE,
      color: this.color,
      opacity: this.opacity,
      pageIndex: this.pageIndex,
      rect,
      drawRect: this.#getSerializedRect(),
      rotation: this.rotation,
    };
  }

  static deserializeFromJSON(data, parent, uiManager) {
    const editor = super.deserialize(data, parent, uiManager);

    const rect = editor.getDeserializedRect(data.drawRect);

    editor.color = data.color;
    editor.opacity = data.opacity || null;
    editor.rect = rect;
    editor.translationX = -1 * rect.startX;
    editor.translationY = -1 * rect.startY;

    editor.wasAddedFromApi = true;

    return editor;
  }
}

export { SquareEditor };

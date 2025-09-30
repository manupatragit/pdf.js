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

import { AnnotationEditorType, shadow } from "../shared/util.js";
import { DOMSVGFactory } from "./display_utils.js";

/**
 * Manage the SVGs drawn on top of the page canvas.
 * It's important to have them directly on top of the canvas because we want to
 * be able to use mix-blend-mode for some of them.
 */
class DrawLayer {
  #parent = null;

  #id = 0;

  #mapping = new Map();

  constructor({ pageIndex }) {
    this.pageIndex = pageIndex;
  }

  setParent(parent) {
    if (!this.#parent) {
      this.#parent = parent;
      return;
    }

    if (this.#parent !== parent) {
      if (this.#mapping.size > 0) {
        for (const root of this.#mapping.values()) {
          root.remove();
          parent.append(root);
        }
      }
      this.#parent = parent;
    }
  }

  static get _svgFactory() {
    return shadow(this, "_svgFactory", new DOMSVGFactory());
  }

  static #setBox(element, { x, y, width, height }) {
    const { style } = element;
    style.top = `${100 * y}%`;
    style.left = `${100 * x}%`;
    style.width = `${100 * width}%`;
    style.height = `${100 * height}%`;
  }

  #createSVG(box) {
    const svg = DrawLayer._svgFactory.create(1, 1, /* skipDimensions = */ true);
    this.#parent.append(svg);
    DrawLayer.#setBox(svg, box);

    return svg;
  }

  highlight({ outlines, box }, color, opacity) {
    const id = this.#id++;
    const root = this.#createSVG(box);
    root.classList.add("highlight");
    const defs = DrawLayer._svgFactory.createElement("defs");
    root.append(defs);
    const path = DrawLayer._svgFactory.createElement("path");
    defs.append(path);
    const pathId = `path_p${this.pageIndex}_${id}`;
    path.setAttribute("id", pathId);
    path.setAttribute(
      "d",
      DrawLayer.#extractPathFromHighlightOutlines(outlines)
    );

    // Create the clipping path for the editor div.
    const clipPath = DrawLayer._svgFactory.createElement("clipPath");
    defs.append(clipPath);
    const clipPathId = `clip_${pathId}`;
    clipPath.setAttribute("id", clipPathId);
    clipPath.setAttribute("clipPathUnits", "objectBoundingBox");
    const clipPathUse = DrawLayer._svgFactory.createElement("use");
    clipPath.append(clipPathUse);
    clipPathUse.setAttribute("href", `#${pathId}`);
    clipPathUse.classList.add("clip");

    const use = DrawLayer._svgFactory.createElement("use");
    root.append(use);
    root.setAttribute("fill", color);
    root.setAttribute("fill-opacity", opacity);
    use.setAttribute("href", `#${pathId}`);

    this.#mapping.set(id, root);

    return { id, clipPathId: `url(#${clipPathId})` };
  }

  underline({ lineRects, box }, color, opacity) {
    const id = this.#id++;
    const root = this.#createSVG(box);
    root.classList.add("underline");
    root.style.color = color;
    const strokeWidthPercent = 10;

    for (const rect of lineRects) {
      const line = DrawLayer._svgFactory.createElement("line");
      root.append(line);

      const { x1, y1, x2, y2 } = rect;
      const rectHeight = y2 - y1;
      const strokeWidth = rectHeight * strokeWidthPercent;
      const upShift = rectHeight * 0.1;

      line.setAttribute("x1", x1);
      line.setAttribute("y1", y2 - upShift);
      line.setAttribute("x2", x2);
      line.setAttribute("y2", y2 - upShift);
      line.setAttribute("stroke", "currentColor");
      line.setAttribute("stroke-width", `${strokeWidth}%`);
    }

    this.#mapping.set(id, root);

    return { id };
  }

  strikeout({ lineRects, box }, color, opacity) {
    const id = this.#id++;
    const root = this.#createSVG(box);
    root.classList.add("strikeout");
    root.style.color = color;
    const strokeWidthPercent = 10;

    for (const rect of lineRects) {
      const line = DrawLayer._svgFactory.createElement("line");
      root.append(line);

      const { x1, y1, x2, y2 } = rect;
      const rectHeight = y2 - y1;
      const strokeWidth = rectHeight * strokeWidthPercent;
      const upShift = rectHeight * 0.41;

      line.setAttribute("x1", x1);
      line.setAttribute("y1", y2 - upShift);
      line.setAttribute("x2", x2);
      line.setAttribute("y2", y2 - upShift);
      line.setAttribute("stroke", "currentColor");
      line.setAttribute("stroke-width", `${strokeWidth}%`);
    }

    this.#mapping.set(id, root);

    return { id };
  }

  drawLinkNode({ lineRects, box }, color = "blue") {
    const id = this.#id++;
    const root = this.#createSVG(box);
    root.classList.add("link-node");
    root.style.color = color;

    let lastY2 = null;
    for (const rect of lineRects) {
      const svgRect = DrawLayer._svgFactory.createElement("rect");

      const { x1, y1: originalY1, x2, y2 } = rect;

      // Fix for overlapping rectangles
      const y1 = lastY2 ? Math.max(lastY2, originalY1) : originalY1;
      const height = y2 - y1;

      if (height <= 0) {
        continue;
      }

      svgRect.setAttribute("x", x1);
      svgRect.setAttribute("y", y1);
      svgRect.setAttribute("width", x2 - x1);
      svgRect.setAttribute("height", height);
      svgRect.setAttribute("stroke", "currentColor");
      svgRect.setAttribute("stroke-width", "3px");
      svgRect.setAttribute("fill", "transparent");
      svgRect.setAttribute("vector-effect", "non-scaling-stroke");

      root.append(svgRect);

      lastY2 = y2;
    }

    this.#mapping.set(id, root);

    return { id };
  }

  highlightOutline({ outlines, box }) {
    // We cannot draw the outline directly in the SVG for highlights because
    // it composes with its parent with mix-blend-mode: multiply.
    // But the outline has a different mix-blend-mode, so we need to draw it in
    // its own SVG.
    const id = this.#id++;
    const root = this.#createSVG(box);
    root.classList.add("highlightOutline");
    const defs = DrawLayer._svgFactory.createElement("defs");
    root.append(defs);
    const path = DrawLayer._svgFactory.createElement("path");
    defs.append(path);
    const pathId = `path_p${this.pageIndex}_${id}`;
    path.setAttribute("id", pathId);
    path.setAttribute(
      "d",
      DrawLayer.#extractPathFromHighlightOutlines(outlines)
    );
    path.setAttribute("vector-effect", "non-scaling-stroke");

    const use1 = DrawLayer._svgFactory.createElement("use");
    root.append(use1);
    use1.setAttribute("href", `#${pathId}`);
    const use2 = use1.cloneNode();
    root.append(use2);
    use1.classList.add("mainOutline");
    use2.classList.add("secondaryOutline");

    this.#mapping.set(id, root);

    return id;
  }

  static #extractPathFromHighlightOutlines(polygons) {
    const buffer = [];
    for (const polygon of polygons) {
      let [prevX, prevY] = polygon;
      buffer.push(`M${prevX} ${prevY}`);
      for (let i = 2; i < polygon.length; i += 2) {
        const x = polygon[i];
        const y = polygon[i + 1];
        if (x === prevX) {
          buffer.push(`V${y}`);
          prevY = y;
        } else if (y === prevY) {
          buffer.push(`H${x}`);
          prevX = x;
        }
      }
      buffer.push("Z");
    }
    return buffer.join(" ");
  }

  updateBox(id, box) {
    DrawLayer.#setBox(this.#mapping.get(id), box);
  }

  rotate(id, angle) {
    this.#mapping.get(id).setAttribute("data-main-rotation", angle);
  }

  changeColor(id, color, annotationType) {
    switch (annotationType) {
      case AnnotationEditorType.UNDERLINE:
      case AnnotationEditorType.STRIKEOUT:
        this.#mapping.get(id).style.color = color;
        break;

      default:
        this.#mapping.get(id).setAttribute("fill", color);
        break;
    }
  }

  changeOpacity(id, opacity) {
    this.#mapping.get(id).setAttribute("fill-opacity", opacity);
  }

  addClass(id, className) {
    this.#mapping.get(id).classList.add(className);
  }

  removeClass(id, className) {
    this.#mapping.get(id).classList.remove(className);
  }

  remove(id) {
    if (this.#parent === null) {
      return;
    }
    this.#mapping.get(id).remove();
    this.#mapping.delete(id);
  }

  destroy() {
    this.#parent = null;
    for (const root of this.#mapping.values()) {
      root.remove();
    }
    this.#mapping.clear();
  }

  hide(id) {
    if (this.#parent === null) {
      return;
    }
    const root = this.#mapping.get(id);
    root.style.display = "none";
  }

  show(id) {
    if (this.#parent === null) {
      return;
    }
    const root = this.#mapping.get(id);
    root.style.display = "block";
  }
}

export { DrawLayer };

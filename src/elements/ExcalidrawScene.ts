import { ExcalidrawGenericElement } from "./ExcalidrawElement";

export type ExcalidrawFileEntry = {
  mimeType: string;
  id: string;
  dataURL: string;
  created: number;
};

class ExcalidrawScene {
  type = "excalidraw";
  version = 2;
  source = "https://excalidraw.com";
  elements: ExcalidrawGenericElement[] = [];
  files: Record<string, ExcalidrawFileEntry> = {};

  constructor(elements: ExcalidrawGenericElement[] = []) {
    this.elements = elements;
  }

  toExJSON(): any {
    return {
      ...this,
      elements: this.elements.map((el) => ({ ...el })),
      files: { ...this.files },
    };
  }
}

export default ExcalidrawScene;

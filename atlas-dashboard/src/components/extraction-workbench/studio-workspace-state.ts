import {
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  useRef,
  type SetStateAction,
  useState,
} from "react";

import type {
  AnnotationBox,
  AnnotationMode,
  AnnotationStatus,
  CableAuthoringMode,
  ClassTrackerEntry,
  ComponentLabelPromptState,
  ComponentAuthoringMode,
  ConnectionPointEditorState,
  ConnectorTerminalPromptState,
  InteractionSession,
  PageMetadata,
  SnapStrength,
  StudioTool,
  SymbolBankEntry,
  WireAuthoringMode,
  WireLabelBankEntry,
} from "./studio-types";
import { DEFAULT_PAGE } from "./studio-types";
import { type BBoxPx } from "./studio-geometry";
import { type HoverStackTarget } from "./overlay-label-layout";

type UseStudioWorkspaceState = {
  activeMode: AnnotationMode;
  setActiveMode: Dispatch<SetStateAction<AnnotationMode>>;
  componentAuthoringMode: ComponentAuthoringMode;
  setComponentAuthoringMode: Dispatch<SetStateAction<ComponentAuthoringMode>>;
  wireAuthoringMode: WireAuthoringMode;
  setWireAuthoringMode: Dispatch<SetStateAction<WireAuthoringMode>>;
  cableAuthoringMode: CableAuthoringMode;
  setCableAuthoringMode: Dispatch<SetStateAction<CableAuthoringMode>>;
  pageNum: number;
  setPageNum: Dispatch<SetStateAction<number>>;
  zoom: number;
  setZoom: Dispatch<SetStateAction<number>>;
  pan: { x: number; y: number };
  setPan: Dispatch<SetStateAction<{ x: number; y: number }>>;
  tool: StudioTool;
  setTool: Dispatch<SetStateAction<StudioTool>>;
  snapStrength: SnapStrength;
  setSnapStrength: Dispatch<SetStateAction<SnapStrength>>;
  overlayPillsVisible: boolean;
  setOverlayPillsVisible: Dispatch<SetStateAction<boolean>>;
  imageStatus: "loading" | "ready" | "error";
  setImageStatus: Dispatch<
    SetStateAction<"loading" | "ready" | "error">
  >;
  metadataStatus: "loading" | "ready" | "error";
  setMetadataStatus: Dispatch<
    SetStateAction<"loading" | "ready" | "error">
  >;
  symbolBankStatus: "loading" | "ready" | "error";
  setSymbolBankStatus: Dispatch<
    SetStateAction<"loading" | "ready" | "error">
  >;
  symbolBankSource: string;
  setSymbolBankSource: Dispatch<SetStateAction<string>>;
  symbolBank: SymbolBankEntry[];
  setSymbolBank: Dispatch<SetStateAction<SymbolBankEntry[]>>;
  wireLabelBankStatus: "loading" | "ready" | "error";
  setWireLabelBankStatus: Dispatch<
    SetStateAction<"loading" | "ready" | "error">
  >;
  wireLabelBankSource: string;
  setWireLabelBankSource: Dispatch<SetStateAction<string>>;
  wireLabelBank: WireLabelBankEntry[];
  setWireLabelBank: Dispatch<SetStateAction<WireLabelBankEntry[]>>;
  classTrackerStatus: "loading" | "ready" | "error";
  setClassTrackerStatus: Dispatch<
    SetStateAction<"loading" | "ready" | "error">
  >;
  classTrackerCounts: ClassTrackerEntry[];
  setClassTrackerCounts: Dispatch<SetStateAction<ClassTrackerEntry[]>>;
  classTrackerTotal: number;
  setClassTrackerTotal: Dispatch<SetStateAction<number>>;
  pageMetadata: PageMetadata | null;
  setPageMetadata: Dispatch<SetStateAction<PageMetadata | null>>;
  cursorPx: { x: number; y: number } | null;
  setCursorPx: Dispatch<
    SetStateAction<{ x: number; y: number } | null>
  >;
  hoverStack: HoverStackTarget[];
  setHoverStack: Dispatch<SetStateAction<HoverStackTarget[]>>;
  boxes: AnnotationBox[];
  setBoxes: Dispatch<SetStateAction<AnnotationBox[]>>;
  selectedBoxId: string | null;
  setSelectedBoxId: Dispatch<SetStateAction<string | null>>;
  selectedAttachmentId: string | null;
  setSelectedAttachmentId: Dispatch<SetStateAction<string | null>>;
  connectionPointEditor: ConnectionPointEditorState | null;
  setConnectionPointEditor: Dispatch<
    SetStateAction<ConnectionPointEditorState | null>
  >;
  connectorTerminalPrompt: ConnectorTerminalPromptState | null;
  setConnectorTerminalPrompt: Dispatch<
    SetStateAction<ConnectorTerminalPromptState | null>
  >;
  componentLabelPrompt: ComponentLabelPromptState | null;
  setComponentLabelPrompt: Dispatch<
    SetStateAction<ComponentLabelPromptState | null>
  >;
  typeMenuAttachmentId: string | null;
  setTypeMenuAttachmentId: Dispatch<SetStateAction<string | null>>;
  typeMenuBoxId: string | null;
  setTypeMenuBoxId: Dispatch<SetStateAction<string | null>>;
  relationNotice: string | null;
  setRelationNotice: Dispatch<SetStateAction<string | null>>;
  draftBox: BBoxPx | null;
  setDraftBox: Dispatch<SetStateAction<BBoxPx | null>>;
  annotationStatus: AnnotationStatus;
  setAnnotationStatus: Dispatch<SetStateAction<AnnotationStatus>>;
  lastSavedAt: string | null;
  setLastSavedAt: Dispatch<SetStateAction<string | null>>;
  stageRef: RefObject<HTMLDivElement | null>;
  interactionRef: MutableRefObject<InteractionSession | null>;
  hoverStackCyclingRef: MutableRefObject<boolean>;
  hoverStackIndexRef: MutableRefObject<number>;
  boxesRef: MutableRefObject<AnnotationBox[]>;
  undoStackRef: MutableRefObject<AnnotationBox[][]>;
  redoStackRef: MutableRefObject<AnnotationBox[][]>;
};

export function useStudioWorkspaceState(): UseStudioWorkspaceState {
  const [activeMode, setActiveMode] = useState<AnnotationMode>("component");
  const [componentAuthoringMode, setComponentAuthoringMode] =
    useState<ComponentAuthoringMode>("component");
  const [wireAuthoringMode, setWireAuthoringMode] =
    useState<WireAuthoringMode>("auto");
  const [cableAuthoringMode, setCableAuthoringMode] =
    useState<CableAuthoringMode>("geometry");
  const [pageNum, setPageNum] = useState(DEFAULT_PAGE);
  const [zoom, setZoom] = useState(0.2);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [tool, setTool] = useState<StudioTool>("box");
  const [snapStrength, setSnapStrength] = useState<SnapStrength>("normal");
  const [overlayPillsVisible, setOverlayPillsVisible] = useState(true);
  const [imageStatus, setImageStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [metadataStatus, setMetadataStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [symbolBankStatus, setSymbolBankStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [symbolBankSource, setSymbolBankSource] = useState("");
  const [symbolBank, setSymbolBank] = useState<SymbolBankEntry[]>([]);
  const [wireLabelBankStatus, setWireLabelBankStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [wireLabelBankSource, setWireLabelBankSource] = useState("");
  const [wireLabelBank, setWireLabelBank] = useState<WireLabelBankEntry[]>([]);
  const [classTrackerStatus, setClassTrackerStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [classTrackerCounts, setClassTrackerCounts] = useState<
    ClassTrackerEntry[]
  >([]);
  const [classTrackerTotal, setClassTrackerTotal] = useState(0);
  const [pageMetadata, setPageMetadata] = useState<PageMetadata | null>(null);
  const [cursorPx, setCursorPx] = useState<{ x: number; y: number } | null>(null);
  const [hoverStack, setHoverStack] = useState<HoverStackTarget[]>([]);
  const [boxes, setBoxes] = useState<AnnotationBox[]>([]);
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [selectedAttachmentId, setSelectedAttachmentId] = useState<string | null>(
    null
  );
  const [connectionPointEditor, setConnectionPointEditor] =
    useState<ConnectionPointEditorState | null>(null);
  const [connectorTerminalPrompt, setConnectorTerminalPrompt] =
    useState<ConnectorTerminalPromptState | null>(null);
  const [componentLabelPrompt, setComponentLabelPrompt] =
    useState<ComponentLabelPromptState | null>(null);
  const [typeMenuAttachmentId, setTypeMenuAttachmentId] = useState<string | null>(
    null
  );
  const [typeMenuBoxId, setTypeMenuBoxId] = useState<string | null>(null);
  const [relationNotice, setRelationNotice] = useState<string | null>(null);
  const [draftBox, setDraftBox] = useState<BBoxPx | null>(null);
  const [annotationStatus, setAnnotationStatus] =
    useState<AnnotationStatus>("loading");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<InteractionSession | null>(null);
  const hoverStackCyclingRef = useRef(false);
  const hoverStackIndexRef = useRef(-1);
  const boxesRef = useRef<AnnotationBox[]>([]);
  const undoStackRef = useRef<AnnotationBox[][]>([]);
  const redoStackRef = useRef<AnnotationBox[][]>([]);

  return {
    activeMode,
    setActiveMode,
    componentAuthoringMode,
    setComponentAuthoringMode,
    wireAuthoringMode,
    setWireAuthoringMode,
    cableAuthoringMode,
    setCableAuthoringMode,
    pageNum,
    setPageNum,
    zoom,
    setZoom,
    pan,
    setPan,
    tool,
    setTool,
    snapStrength,
    setSnapStrength,
    overlayPillsVisible,
    setOverlayPillsVisible,
    imageStatus,
    setImageStatus,
    metadataStatus,
    setMetadataStatus,
    symbolBankStatus,
    setSymbolBankStatus,
    symbolBankSource,
    setSymbolBankSource,
    symbolBank,
    setSymbolBank,
    wireLabelBankStatus,
    setWireLabelBankStatus,
    wireLabelBankSource,
    setWireLabelBankSource,
    wireLabelBank,
    setWireLabelBank,
    classTrackerStatus,
    setClassTrackerStatus,
    classTrackerCounts,
    setClassTrackerCounts,
    classTrackerTotal,
    setClassTrackerTotal,
    pageMetadata,
    setPageMetadata,
    cursorPx,
    setCursorPx,
    hoverStack,
    setHoverStack,
    boxes,
    setBoxes,
    selectedBoxId,
    setSelectedBoxId,
    selectedAttachmentId,
    setSelectedAttachmentId,
    connectionPointEditor,
    setConnectionPointEditor,
    connectorTerminalPrompt,
    setConnectorTerminalPrompt,
    componentLabelPrompt,
    setComponentLabelPrompt,
    typeMenuAttachmentId,
    setTypeMenuAttachmentId,
    typeMenuBoxId,
    setTypeMenuBoxId,
    relationNotice,
    setRelationNotice,
    draftBox,
    setDraftBox,
    annotationStatus,
    setAnnotationStatus,
    lastSavedAt,
    setLastSavedAt,
    stageRef,
    interactionRef,
    hoverStackCyclingRef,
    hoverStackIndexRef,
    boxesRef,
    undoStackRef,
    redoStackRef,
  };
}

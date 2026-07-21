import {
  type Dispatch,
  type SetStateAction,
  type MutableRefObject,
  useEffect,
  useRef,
} from "react";

import { replacePageAnnotations } from "./studio-page-annotations";
import {
  AnnotationStatus,
  type AnnotationWorkspaceMode,
  PageMetadata,
  type AnnotationBox,
  type SymbolBankEntry,
  type WireLabelBankEntry,
} from "./studio-types";
import {
  fetchPageAnnotations,
  fetchPageMetadata,
  fetchSymbolBank,
  fetchWireLabelBank,
} from "./studio-api";
import { agentBaseUrl } from "@/lib/agent-base-url";
import { DOCUMENT_ID, PROJECT_ID } from "./studio-types";

type LoadStatus = "loading" | "ready" | "error";

type DataStateCallbacks = {
  setMetadataStatus: Dispatch<SetStateAction<LoadStatus>>;
  setSymbolBankStatus: Dispatch<SetStateAction<LoadStatus>>;
  setSymbolBankSource: Dispatch<SetStateAction<string>>;
  setWireLabelBankStatus: Dispatch<SetStateAction<LoadStatus>>;
  setWireLabelBankSource: Dispatch<SetStateAction<string>>;
  setPageMetadata: Dispatch<SetStateAction<PageMetadata | null>>;
  setSymbolBank: Dispatch<SetStateAction<SymbolBankEntry[]>>;
  setWireLabelBank: Dispatch<SetStateAction<WireLabelBankEntry[]>>;
  setBoxes: Dispatch<SetStateAction<AnnotationBox[]>>;
  setAnnotationStatus: Dispatch<SetStateAction<AnnotationStatus>>;
  setSelectedAttachmentId: Dispatch<SetStateAction<string | null>>;
  setTypeMenuAttachmentId: Dispatch<SetStateAction<string | null>>;
  refreshHistoryControls: () => void;
  boxesRef: MutableRefObject<AnnotationBox[]>;
  undoStackRef: MutableRefObject<AnnotationBox[][]>;
  redoStackRef: MutableRefObject<AnnotationBox[][]>;
};

export type UseStudioPageDataOptions = {
  pageNum: number;
  annotationWorkspaceMode: AnnotationWorkspaceMode;
} & DataStateCallbacks;

export function useStudioPageData({
  pageNum,
  annotationWorkspaceMode,
  setMetadataStatus,
  setSymbolBankStatus,
  setSymbolBankSource,
  setWireLabelBankStatus,
  setWireLabelBankSource,
  setPageMetadata,
  setSymbolBank,
  setWireLabelBank,
  setBoxes,
  setAnnotationStatus,
  setSelectedAttachmentId,
  setTypeMenuAttachmentId,
  refreshHistoryControls,
  boxesRef,
  undoStackRef,
  redoStackRef,
}: UseStudioPageDataOptions) {
  const loadedWorkspaceModeRef = useRef<AnnotationWorkspaceMode | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPageMetadata(fetch, agentBaseUrl(), PROJECT_ID, DOCUMENT_ID, pageNum)
      .then((metadata) => {
        if (cancelled) return;
        setPageMetadata(metadata);
        setMetadataStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setMetadataStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [pageNum, setMetadataStatus, setPageMetadata]);

  useEffect(() => {
    let cancelled = false;
    fetchSymbolBank(fetch, agentBaseUrl(), PROJECT_ID, DOCUMENT_ID)
      .then((payload) => {
        if (cancelled) return;
        setSymbolBank(payload.symbols ?? []);
        setSymbolBankSource(payload.source ?? "");
        setSymbolBankStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setSymbolBank([]);
        setSymbolBankSource("");
        setSymbolBankStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [setSymbolBank, setSymbolBankSource, setSymbolBankStatus]);

  useEffect(() => {
    let cancelled = false;
    fetchWireLabelBank(fetch, agentBaseUrl(), PROJECT_ID, DOCUMENT_ID)
      .then((payload) => {
        if (cancelled) return;
        setWireLabelBank(payload.wire_labels ?? []);
        setWireLabelBankSource(payload.source ?? "");
        setWireLabelBankStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setWireLabelBank([]);
        setWireLabelBankSource("");
        setWireLabelBankStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [setWireLabelBank, setWireLabelBankSource, setWireLabelBankStatus]);

  useEffect(() => {
    let cancelled = false;
    const loadingWorkspaceMode = annotationWorkspaceMode;
    if (loadedWorkspaceModeRef.current !== loadingWorkspaceMode) {
      loadedWorkspaceModeRef.current = loadingWorkspaceMode;
      setBoxes([]);
      boxesRef.current = [];
      undoStackRef.current = [];
      redoStackRef.current = [];
      refreshHistoryControls();
      setSelectedAttachmentId(null);
      setTypeMenuAttachmentId(null);
    }
    setAnnotationStatus("loading");
    fetchPageAnnotations(
      fetch,
      agentBaseUrl(),
      PROJECT_ID,
      DOCUMENT_ID,
      pageNum,
      annotationWorkspaceMode
    )
      .then((payload) => {
        if (cancelled) return;
        if (
          payload.annotationMode &&
          payload.annotationMode !== loadingWorkspaceMode
        ) {
          setBoxes([]);
          boxesRef.current = [];
          setAnnotationStatus("error");
          return;
        }
        setBoxes((current) => {
          const next = replacePageAnnotations(
            current,
            pageNum,
            payload.annotations ?? []
          );
          boxesRef.current = next;
          return next;
        });
        undoStackRef.current = [];
        redoStackRef.current = [];
        refreshHistoryControls();
        setSelectedAttachmentId(null);
        setTypeMenuAttachmentId(null);
        setAnnotationStatus("saved");
      })
      .catch(() => {
        if (cancelled) return;
        setBoxes((current) => {
          const next = replacePageAnnotations(current, pageNum, []);
          boxesRef.current = next;
          return next;
        });
        setAnnotationStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [
    pageNum,
    annotationWorkspaceMode,
    boxesRef,
    redoStackRef,
    refreshHistoryControls,
    setAnnotationStatus,
    setBoxes,
    setSelectedAttachmentId,
    setTypeMenuAttachmentId,
    undoStackRef,
  ]);
}

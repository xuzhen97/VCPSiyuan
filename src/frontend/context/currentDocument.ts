export interface CurrentDocumentEditor {
    block?: { rootID?: string };
}

export interface CurrentDocumentSource {
    getCurrentDocumentId(): string | null;
}

export function createCurrentDocumentSource(
    readEditors: () => ReadonlyArray<CurrentDocumentEditor>,
): CurrentDocumentSource {
    return {
        getCurrentDocumentId(): string | null {
            for (const editor of readEditors()) {
                const rootId = editor.block?.rootID;
                if (typeof rootId === "string" && rootId.trim().length > 0)
                    return rootId;
            }
            return null;
        },
    };
}

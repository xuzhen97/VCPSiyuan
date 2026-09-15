export function getAllEditor(): Array<{
    protyle: { block?: { rootID?: string } };
}> {
    return [];
}

export class Plugin {
    public app: unknown;
    public name: string;
    public displayName: string;
    public i18n: Record<string, string>;
    public kernel: {
        rpc: { call: Record<string, (args: unknown) => Promise<unknown>> };
    };
    public eventBus: {
        on: (event: string, handler: (event: unknown) => void) => void;
        off: (event: string, handler: (event: unknown) => void) => void;
    } = {
        on: () => {},
        off: () => {},
    };
    public docks: Record<string, unknown> = {};
    public setting: unknown;

    constructor(options: {
        app: unknown;
        name: string;
        displayName: string;
        i18n: Record<string, string>;
    }) {
        this.app = options.app;
        this.name = options.name;
        this.displayName = options.displayName;
        this.i18n = options.i18n;
        this.kernel = {
            rpc: {
                call: {},
            },
        };
    }

    addIcons(svg: string): void {
        void svg;
    }

    addDock(options: unknown): void {
        void options;
    }

    openSetting(): void {}

    async loadData(storageName: string): Promise<unknown> {
        void storageName;
        return null;
    }

    async saveData(storageName: string, data: unknown): Promise<void> {
        void storageName;
        void data;
    }

    async removeData(storageName: string): Promise<void> {
        void storageName;
    }

    getSecret(name: string): string {
        void name;
        return "";
    }
}

export class Setting {
    public items: unknown[] = [];
    public confirmCallback?: () => void;

    constructor(options: { confirmCallback?: () => void } = {}) {
        this.confirmCallback = options.confirmCallback;
    }

    addItem(item: unknown): void {
        this.items.push(item);
    }
}

export function showMessage(message: string): void {
    void message;
}

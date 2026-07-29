export namespace backend {

	export class AutomationStatus {
	    enabled: boolean;
	    mode?: string;
	    serverUrl?: string;
	    port?: number;
	    e2eOnly?: boolean;
	    packageVersion?: string;
	    pid?: number;
	    executable?: string;
	    startedAt?: number;
	    bridgeMethods?: string[];

	    static createFrom(source: any = {}) {
	        return new AutomationStatus(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enabled = source["enabled"];
	        this.mode = source["mode"];
	        this.serverUrl = source["serverUrl"];
	        this.port = source["port"];
	        this.e2eOnly = source["e2eOnly"];
	        this.packageVersion = source["packageVersion"];
	        this.pid = source["pid"];
	        this.executable = source["executable"];
	        this.startedAt = source["startedAt"];
	        this.bridgeMethods = source["bridgeMethods"];
	    }
	}
	export class BatchInputImage {
	    path: string;
	    name: string;
	    size: number;
	    width?: number;
	    height?: number;
	    previewUrl?: string;
	    previewWidth?: number;
	    previewHeight?: number;

	    static createFrom(source: any = {}) {
	        return new BatchInputImage(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.name = source["name"];
	        this.size = source["size"];
	        this.width = source["width"];
	        this.height = source["height"];
	        this.previewUrl = source["previewUrl"];
	        this.previewWidth = source["previewWidth"];
	        this.previewHeight = source["previewHeight"];
	    }
	}
	export class BatchInputDirectory {
	    directory: string;
	    images: BatchInputImage[];

	    static createFrom(source: any = {}) {
	        return new BatchInputDirectory(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.directory = source["directory"];
	        this.images = this.convertValues(source["images"], BatchInputImage);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

	export class CLIConfigSyncInput {
	    apiKey: string;
	    clearAPIKey: boolean;
	    baseURL: string;
	    apiMode: string;
	    requestPolicy: string;
	    imagesNewAPICompat: boolean;
	    textModelID: string;
	    imageModelID: string;
	    outputFormat: string;
	    quality: string;
	    size: string;
	    partialImages: number;

	    static createFrom(source: any = {}) {
	        return new CLIConfigSyncInput(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.apiKey = source["apiKey"];
	        this.clearAPIKey = source["clearAPIKey"];
	        this.baseURL = source["baseURL"];
	        this.apiMode = source["apiMode"];
	        this.requestPolicy = source["requestPolicy"];
	        this.imagesNewAPICompat = source["imagesNewAPICompat"];
	        this.textModelID = source["textModelID"];
	        this.imageModelID = source["imageModelID"];
	        this.outputFormat = source["outputFormat"];
	        this.quality = source["quality"];
	        this.size = source["size"];
	        this.partialImages = source["partialImages"];
	    }
	}
	export class CLIConfigSyncResult {
	    path: string;
	    apiKeyPresent: boolean;

	    static createFrom(source: any = {}) {
	        return new CLIConfigSyncResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.apiKeyPresent = source["apiKeyPresent"];
	    }
	}
	export class GenerateOptions {
	    apiKey: string;
	    mode: string;
	    requestedJobId: string;
	    prompt: string;
	    size: string;
	    quality: string;
	    outputFormat: string;
	    imagePaths: string[];
	    imagePath: string;
	    maskB64: string;
	    seed: number;
	    negativePrompt: string;
	    baseURL: string;
	    textModelID: string;
	    imageModelID: string;
	    apiMode: string;
	    apiProfileId: string;
	    requestPolicy: string;
	    imagesNewAPICompat: boolean;
	    proxyMode: string;
	    proxyURL: string;
	    noPromptRevision: boolean;
	    concurrencyLimit: number;
	    partialImages: number;

	    static createFrom(source: any = {}) {
	        return new GenerateOptions(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.apiKey = source["apiKey"];
	        this.mode = source["mode"];
	        this.requestedJobId = source["requestedJobId"];
	        this.prompt = source["prompt"];
	        this.size = source["size"];
	        this.quality = source["quality"];
	        this.outputFormat = source["outputFormat"];
	        this.imagePaths = source["imagePaths"];
	        this.imagePath = source["imagePath"];
	        this.maskB64 = source["maskB64"];
	        this.seed = source["seed"];
	        this.negativePrompt = source["negativePrompt"];
	        this.baseURL = source["baseURL"];
	        this.textModelID = source["textModelID"];
	        this.imageModelID = source["imageModelID"];
	        this.apiMode = source["apiMode"];
	        this.apiProfileId = source["apiProfileId"];
	        this.requestPolicy = source["requestPolicy"];
	        this.imagesNewAPICompat = source["imagesNewAPICompat"];
	        this.proxyMode = source["proxyMode"];
	        this.proxyURL = source["proxyURL"];
	        this.noPromptRevision = source["noPromptRevision"];
	        this.concurrencyLimit = source["concurrencyLimit"];
	        this.partialImages = source["partialImages"];
	    }
	}
	export class ImageTransformResult {
	    path: string;
	    acceleration?: string;

	    static createFrom(source: any = {}) {
	        return new ImageTransformResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.acceleration = source["acceleration"];
	    }
	}
	export class ImportedImage {
	    path: string;
	    imageB64?: string;
	    imageId?: string;
	    previewUrl?: string;
	    width?: number;
	    height?: number;
	    previewWidth?: number;
	    previewHeight?: number;

	    static createFrom(source: any = {}) {
	        return new ImportedImage(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.imageB64 = source["imageB64"];
	        this.imageId = source["imageId"];
	        this.previewUrl = source["previewUrl"];
	        this.width = source["width"];
	        this.height = source["height"];
	        this.previewWidth = source["previewWidth"];
	        this.previewHeight = source["previewHeight"];
	    }
	}
	export class JobStarted {
	    jobId: string;

	    static createFrom(source: any = {}) {
	        return new JobStarted(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.jobId = source["jobId"];
	    }
	}
	export class MaterialOutputSyncItem {
	    historyId: string;
	    savedPath: string;
	    suggestedName?: string;
	    missingReason?: string;

	    static createFrom(source: any = {}) {
	        return new MaterialOutputSyncItem(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.historyId = source["historyId"];
	        this.savedPath = source["savedPath"];
	        this.suggestedName = source["suggestedName"];
	        this.missingReason = source["missingReason"];
	    }
	}
	export class MaterialOutputSyncMissing {
	    historyId: string;
	    path?: string;
	    reason: string;

	    static createFrom(source: any = {}) {
	        return new MaterialOutputSyncMissing(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.historyId = source["historyId"];
	        this.path = source["path"];
	        this.reason = source["reason"];
	    }
	}
	export class MaterialOutputSyncedFile {
	    historyId: string;
	    source: string;
	    path: string;

	    static createFrom(source: any = {}) {
	        return new MaterialOutputSyncedFile(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.historyId = source["historyId"];
	        this.source = source["source"];
	        this.path = source["path"];
	    }
	}
	export class MaterialOutputSyncResult {
	    targetDir: string;
	    synced: number;
	    missing: number;
	    files: MaterialOutputSyncedFile[];
	    missingItems: MaterialOutputSyncMissing[];

	    static createFrom(source: any = {}) {
	        return new MaterialOutputSyncResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.targetDir = source["targetDir"];
	        this.synced = source["synced"];
	        this.missing = source["missing"];
	        this.files = this.convertValues(source["files"], MaterialOutputSyncedFile);
	        this.missingItems = this.convertValues(source["missingItems"], MaterialOutputSyncMissing);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

	export class MediaAssetRef {
	    imageId?: string;
	    savedPath?: string;
	    thumbPath?: string;
	    previewUrl?: string;
	    fullUrl?: string;
	    width?: number;
	    height?: number;
	    previewWidth?: number;
	    previewHeight?: number;

	    static createFrom(source: any = {}) {
	        return new MediaAssetRef(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.imageId = source["imageId"];
	        this.savedPath = source["savedPath"];
	        this.thumbPath = source["thumbPath"];
	        this.previewUrl = source["previewUrl"];
	        this.fullUrl = source["fullUrl"];
	        this.width = source["width"];
	        this.height = source["height"];
	        this.previewWidth = source["previewWidth"];
	        this.previewHeight = source["previewHeight"];
	    }
	}
	export class PSBridgeImageCapabilities {
	    aspectPresets: string[];
	    resolutionPresets: string[];
	    qualityControl: boolean;
	    sizeEncoding: string;

	    static createFrom(source: any = {}) {
	        return new PSBridgeImageCapabilities(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.aspectPresets = source["aspectPresets"];
	        this.resolutionPresets = source["resolutionPresets"];
	        this.qualityControl = source["qualityControl"];
	        this.sizeEncoding = source["sizeEncoding"];
	    }
	}
	export class PSBridgePromptProfileInput {
	    provider: string;
	    label: string;
	    baseURL: string;
	    credentialUser: string;
	    textModelID: string;

	    static createFrom(source: any = {}) {
	        return new PSBridgePromptProfileInput(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.provider = source["provider"];
	        this.label = source["label"];
	        this.baseURL = source["baseURL"];
	        this.credentialUser = source["credentialUser"];
	        this.textModelID = source["textModelID"];
	    }
	}
	export class PSBridgeProfileInput {
	    profileId: string;
	    name: string;
	    apiMode: string;
	    baseURL: string;
	    credentialUser: string;
	    textModelID: string;
	    imageModelID: string;
	    requestPolicy: string;
	    imagesNewAPICompat: boolean;
	    proxyMode: string;
	    proxyURL: string;
	    concurrencyLimit: number;
	    imageCapabilities: PSBridgeImageCapabilities;
	    promptProfile?: PSBridgePromptProfileInput;

	    static createFrom(source: any = {}) {
	        return new PSBridgeProfileInput(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.profileId = source["profileId"];
	        this.name = source["name"];
	        this.apiMode = source["apiMode"];
	        this.baseURL = source["baseURL"];
	        this.credentialUser = source["credentialUser"];
	        this.textModelID = source["textModelID"];
	        this.imageModelID = source["imageModelID"];
	        this.requestPolicy = source["requestPolicy"];
	        this.imagesNewAPICompat = source["imagesNewAPICompat"];
	        this.proxyMode = source["proxyMode"];
	        this.proxyURL = source["proxyURL"];
	        this.concurrencyLimit = source["concurrencyLimit"];
	        this.imageCapabilities = this.convertValues(source["imageCapabilities"], PSBridgeImageCapabilities);
	        this.promptProfile = this.convertValues(source["promptProfile"], PSBridgePromptProfileInput);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PSBridgeProfilePublic {
	    profileId: string;
	    name: string;
	    provider: string;
	    apiMode: string;
	    imageModelID: string;
	    supportsMask: boolean;
	    maxImages: number;
	    ready: boolean;
	    promptOptimizationReady: boolean;
	    promptProviderLabel?: string;
	    imageCapabilities: PSBridgeImageCapabilities;

	    static createFrom(source: any = {}) {
	        return new PSBridgeProfilePublic(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.profileId = source["profileId"];
	        this.name = source["name"];
	        this.provider = source["provider"];
	        this.apiMode = source["apiMode"];
	        this.imageModelID = source["imageModelID"];
	        this.supportsMask = source["supportsMask"];
	        this.maxImages = source["maxImages"];
	        this.ready = source["ready"];
	        this.promptOptimizationReady = source["promptOptimizationReady"];
	        this.promptProviderLabel = source["promptProviderLabel"];
	        this.imageCapabilities = this.convertValues(source["imageCapabilities"], PSBridgeImageCapabilities);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

	export class PSBridgeRemoteCompletion {
	    jobId: string;
	    imageB64: string;
	    revisedPrompt: string;
	    sourceEvent: string;
	    rawPath: string;

	    static createFrom(source: any = {}) {
	        return new PSBridgeRemoteCompletion(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.jobId = source["jobId"];
	        this.imageB64 = source["imageB64"];
	        this.revisedPrompt = source["revisedPrompt"];
	        this.sourceEvent = source["sourceEvent"];
	        this.rawPath = source["rawPath"];
	    }
	}
	export class PSBridgeRemoteFailure {
	    jobId: string;
	    message: string;
	    rawPath: string;

	    static createFrom(source: any = {}) {
	        return new PSBridgeRemoteFailure(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.jobId = source["jobId"];
	        this.message = source["message"];
	        this.rawPath = source["rawPath"];
	    }
	}
	export class PSBridgeRemoteProgress {
	    jobId: string;
	    stage: string;
	    elapsed: number;
	    bytes: number;

	    static createFrom(source: any = {}) {
	        return new PSBridgeRemoteProgress(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.jobId = source["jobId"];
	        this.stage = source["stage"];
	        this.elapsed = source["elapsed"];
	        this.bytes = source["bytes"];
	    }
	}
	export class PSBridgeStatus {
	    running: boolean;
	    port?: number;
	    instanceId?: string;
	    profileReady: boolean;
	    profile?: PSBridgeProfilePublic;

	    static createFrom(source: any = {}) {
	        return new PSBridgeStatus(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.running = source["running"];
	        this.port = source["port"];
	        this.instanceId = source["instanceId"];
	        this.profileReady = source["profileReady"];
	        this.profile = this.convertValues(source["profile"], PSBridgeProfilePublic);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ProbeUpstreamOptions {
	    apiKey: string;
	    baseURL: string;
	    proxyMode: string;
	    proxyURL: string;

	    static createFrom(source: any = {}) {
	        return new ProbeUpstreamOptions(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.apiKey = source["apiKey"];
	        this.baseURL = source["baseURL"];
	        this.proxyMode = source["proxyMode"];
	        this.proxyURL = source["proxyURL"];
	    }
	}
	export class ProbeUpstreamResult {
	    modelCount: number;

	    static createFrom(source: any = {}) {
	        return new ProbeUpstreamResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.modelCount = source["modelCount"];
	    }
	}
	export class PromptOptimizeOptions {
	    apiKey: string;
	    prompt: string;
	    optimizationGuidance: string;
	    mode: string;
	    baseURL: string;
	    textModelID: string;
	    proxyMode: string;
	    proxyURL: string;
	    imagePaths: string[];
	    imagePath: string;

	    static createFrom(source: any = {}) {
	        return new PromptOptimizeOptions(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.apiKey = source["apiKey"];
	        this.prompt = source["prompt"];
	        this.optimizationGuidance = source["optimizationGuidance"];
	        this.mode = source["mode"];
	        this.baseURL = source["baseURL"];
	        this.textModelID = source["textModelID"];
	        this.proxyMode = source["proxyMode"];
	        this.proxyURL = source["proxyURL"];
	        this.imagePaths = source["imagePaths"];
	        this.imagePath = source["imagePath"];
	    }
	}
	export class PromptReverseOptions {
	    apiKey: string;
	    baseURL: string;
	    textModelID: string;
	    proxyMode: string;
	    proxyURL: string;
	    imagePaths: string[];
	    imagePath: string;

	    static createFrom(source: any = {}) {
	        return new PromptReverseOptions(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.apiKey = source["apiKey"];
	        this.baseURL = source["baseURL"];
	        this.textModelID = source["textModelID"];
	        this.proxyMode = source["proxyMode"];
	        this.proxyURL = source["proxyURL"];
	        this.imagePaths = source["imagePaths"];
	        this.imagePath = source["imagePath"];
	    }
	}
	export class SelectFileResponse {
	    path: string;
	    name?: string;
	    size: number;
	    imageB64?: string;
	    imageId?: string;
	    previewUrl?: string;
	    width?: number;
	    height?: number;
	    previewWidth?: number;
	    previewHeight?: number;

	    static createFrom(source: any = {}) {
	        return new SelectFileResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.name = source["name"];
	        this.size = source["size"];
	        this.imageB64 = source["imageB64"];
	        this.imageId = source["imageId"];
	        this.previewUrl = source["previewUrl"];
	        this.width = source["width"];
	        this.height = source["height"];
	        this.previewWidth = source["previewWidth"];
	        this.previewHeight = source["previewHeight"];
	    }
	}
	export class SelectFilesResponse {
	    files: BatchInputImage[];

	    static createFrom(source: any = {}) {
	        return new SelectFilesResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.files = this.convertValues(source["files"], BatchInputImage);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}


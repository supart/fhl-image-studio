export namespace backend {

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
	    proxyMode: string;
	    proxyURL: string;
	    apiMode: string;
	    requestPolicy: string;
	    imagesNewAPICompat: boolean;
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
	        this.proxyMode = source["proxyMode"];
	        this.proxyURL = source["proxyURL"];
	        this.apiMode = source["apiMode"];
	        this.requestPolicy = source["requestPolicy"];
	        this.imagesNewAPICompat = source["imagesNewAPICompat"];
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
	export class MediaAssetRef {
	    imageId?: string;
	    savedPath?: string;
	    thumbPath?: string;
	    previewUrl?: string;
	    fullUrl?: string;
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
	        this.previewWidth = source["previewWidth"];
	        this.previewHeight = source["previewHeight"];
	    }
	}
	export class PreviewPayload {
	    imageB64?: string;
	    imageId?: string;
	    previewUrl?: string;
	    previewWidth?: number;
	    previewHeight?: number;
	    revisedPrompt?: string;
	    partialImageIndex: number;
	    mode: string;
	    prompt: string;

	    static createFrom(source: any = {}) {
	        return new PreviewPayload(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.imageB64 = source["imageB64"];
	        this.imageId = source["imageId"];
	        this.previewUrl = source["previewUrl"];
	        this.previewWidth = source["previewWidth"];
	        this.previewHeight = source["previewHeight"];
	        this.revisedPrompt = source["revisedPrompt"];
	        this.partialImageIndex = source["partialImageIndex"];
	        this.mode = source["mode"];
	        this.prompt = source["prompt"];
	    }
	}
	export class PromptOptimizeOptions {
	    apiKey: string;
	    prompt: string;
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
	        this.mode = source["mode"];
	        this.baseURL = source["baseURL"];
	        this.textModelID = source["textModelID"];
	        this.proxyMode = source["proxyMode"];
	        this.proxyURL = source["proxyURL"];
	        this.imagePaths = source["imagePaths"];
	        this.imagePath = source["imagePath"];
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
	export class SelectFileResponse {
	    path: string;
	    size: number;
	    imageB64?: string;
	    imageId?: string;
	    previewUrl?: string;
	    previewWidth?: number;
	    previewHeight?: number;

	    static createFrom(source: any = {}) {
	        return new SelectFileResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.size = source["size"];
	        this.imageB64 = source["imageB64"];
	        this.imageId = source["imageId"];
	        this.previewUrl = source["previewUrl"];
	        this.previewWidth = source["previewWidth"];
	        this.previewHeight = source["previewHeight"];
	    }
	}

}

export interface paths {
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/products/enrich": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Safely retrieves JSON-LD Product or Open Graph metadata. All returned fields are editable claims and must be confirmed by the user. */
        post: operations["enrichProduct"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/products/analyze": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["analyzeProduct"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/hooks/generate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["generateHooks"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/video-plans/generate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["generateVideoPlan"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/voices/generate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Returns AI-generated voice audio. Clients must disclose that the voice is AI-generated. */
        post: operations["generateVoice"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        ProductEnrichRequest: {
            productUrl: string;
        };
        ProductEnrichResponse: {
            productUrl: string;
            productName: string;
            brand: string;
            features: string[];
            imageUrl: string;
            sources: ("json-ld" | "open-graph" | "html-title")[];
            warnings: string[];
        };
        Frame: {
            timestampSeconds: number;
            /** @enum {string} */
            mimeType: "image/jpeg" | "image/webp";
            dataBase64: string;
        };
        ProductAnalyzeRequest: {
            productName: string;
            brand: string;
            productUrl: string;
            features: string[];
            frames: components["schemas"]["Frame"][];
        };
        RelevantScene: {
            timestampSeconds: number;
            description: string;
            sceneType: string;
        };
        ProductAnalysis: {
            summary: string;
            targetAudience: string[];
            useCases: string[];
            verifiedFacts: string[];
            userProvidedClaims: string[];
            warnings: string[];
            relevantScenes: components["schemas"]["RelevantScene"][];
        };
        Hook: {
            id: string;
            text: string;
            /** @enum {string} */
            type: "curiosity" | "problem" | "result" | "comparison" | "warning" | "value" | "review";
            reason: string;
            recommendedScene: string;
        };
        HookGenerateRequest: {
            productName: string;
            brand: string;
            analysis: components["schemas"]["ProductAnalysis"];
        };
        HookGenerateResponse: {
            hooks: components["schemas"]["Hook"][];
        };
        Scene: {
            sourceStartSeconds: number;
            sourceEndSeconds: number;
            outputStartSeconds: number;
            outputEndSeconds: number;
            purpose: string;
        };
        Subtitle: {
            text: string;
            startSeconds: number;
            endSeconds: number;
            highlightWords: string[];
        };
        Overlay: {
            text: string;
            startSeconds: number;
            endSeconds: number;
            /** @enum {string} */
            position: "top" | "center" | "bottom";
        };
        VideoPlan: {
            /** @constant */
            version: 1;
            durationSeconds: number;
            voiceScript: string;
            scenes: components["schemas"]["Scene"][];
            subtitles: components["schemas"]["Subtitle"][];
            overlays: components["schemas"]["Overlay"][];
        };
        VideoPlanGenerateRequest: {
            selectedHook: components["schemas"]["Hook"];
            productAnalysis: components["schemas"]["ProductAnalysis"];
            availableFrameTimestamps: number[];
            sourceDurationSeconds: number;
            /** @enum {integer} */
            requestedDurationSeconds: 15 | 20 | 30;
            voiceStyle: string;
            subtitleStyle: string;
        };
        VoiceGenerateRequest: {
            text: string;
            /** @enum {string} */
            voice: "alloy" | "ash" | "ballad" | "coral" | "echo" | "fable" | "nova" | "onyx" | "sage" | "shimmer" | "verse" | "marin" | "cedar";
            style: string;
            /** @enum {integer} */
            targetDurationSeconds: 15 | 20 | 30;
        };
        APIError: {
            error: {
                code: string;
                message: string;
                requestId?: string;
                details?: {
                    [key: string]: unknown;
                };
            };
        };
    };
    responses: {
        /** @description Invalid request */
        BadRequest: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["APIError"];
            };
        };
        /** @description Request body too large */
        RequestTooLarge: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["APIError"];
            };
        };
        /** @description Rate limit exceeded */
        RateLimited: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["APIError"];
            };
        };
        /** @description The page could not be safely retrieved or did not expose usable product metadata */
        ProductEnrichmentFailed: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["APIError"];
            };
        };
        /** @description Internal error */
        InternalError: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["APIError"];
            };
        };
    };
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getHealth: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Healthy */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        status: "ok";
                        service: string;
                    };
                };
            };
        };
    };
    enrichProduct: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProductEnrichRequest"];
            };
        };
        responses: {
            /** @description Editable product metadata */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProductEnrichResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            422: components["responses"]["ProductEnrichmentFailed"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
        };
    };
    analyzeProduct: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProductAnalyzeRequest"];
            };
        };
        responses: {
            /** @description Product analysis */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProductAnalysis"];
                };
            };
            400: components["responses"]["BadRequest"];
            413: components["responses"]["RequestTooLarge"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
        };
    };
    generateHooks: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HookGenerateRequest"];
            };
        };
        responses: {
            /** @description Six to ten hooks */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HookGenerateResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
        };
    };
    generateVideoPlan: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VideoPlanGenerateRequest"];
            };
        };
        responses: {
            /** @description Validated edit plan */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VideoPlan"];
                };
            };
            400: components["responses"]["BadRequest"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
        };
    };
    generateVoice: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VoiceGenerateRequest"];
            };
        };
        responses: {
            /** @description Generated MP3 or development WAV */
            200: {
                headers: {
                    "X-AI-Generated"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    "audio/mpeg": string;
                    "audio/wav": string;
                };
            };
            400: components["responses"]["BadRequest"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
        };
    };
}

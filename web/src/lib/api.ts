// API client：统一指向 Go API 服务（NEXT_PUBLIC_API_BASE）

const BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8082";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${BASE}/v1${path}`, {
        ...init,
        headers: {
            "Content-Type": "application/json",
            ...(init?.headers || {}),
        },
        cache: "no-store",
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
}

export interface Project {
    id: number;
    name: string;
    token: string;
    description: string;
    status: number;
    created_at: string;
}
export interface ApiList<T> {
    data: T[];
}
export interface ApiOne<T> {
    data: T;
}

// 注意：from / to 统一使用毫秒（ms）时间戳，与 Go API 一致。
export const api = {
    listProjects: () => req<ApiList<Project>>("/projects"),
    createProject: (body: { name: string; description?: string }) =>
        req<ApiOne<{ id: number; name: string; token: string }>>("/projects", {
            method: "POST",
            body: JSON.stringify(body),
        }),
    getProject: (id: number | string) => req<ApiOne<Project>>(`/projects/${id}`),
    topEvents: (
        id: number | string,
        params?: { from?: number; to?: number; limit?: number },
    ) => {
        const q = new URLSearchParams();
        if (params?.from) q.set("from", String(params.from));
        if (params?.to) q.set("to", String(params.to));
        if (params?.limit) q.set("limit", String(params.limit));
        return req<ApiList<{ event: string; count: number; users: number }>>(
            `/projects/${id}/analytics/top_events?${q}`,
        );
    },
    trend: (
        id: number | string,
        event: string,
        params?: { from?: number; to?: number; interval?: "hour" | "day" },
    ) => {
        const q = new URLSearchParams({ event });
        if (params?.from) q.set("from", String(params.from));
        if (params?.to) q.set("to", String(params.to));
        if (params?.interval) q.set("interval", params.interval);
        return req<ApiList<{ bucket: string; count: number }>>(
            `/projects/${id}/analytics/trend?${q}`,
        );
    },
    funnel: (
        id: number | string,
        body: {
            events: string[];
            from?: number;
            to?: number;
            window_seconds?: number;
        },
    ) =>
        req<
            ApiOne<{ steps: { event: string; users: number; conversion: number }[] }>
        >(`/projects/${id}/analytics/funnel`, {
            method: "POST",
            body: JSON.stringify(body),
        }),
    retention: (
        id: number | string,
        params: {
            initial_event: string;
            return_event: string;
            from?: number;
            to?: number;
            days?: number;
        },
    ) => {
        const q = new URLSearchParams({
            initial_event: params.initial_event,
            return_event: params.return_event,
        });
        if (params.from) q.set("from", String(params.from));
        if (params.to) q.set("to", String(params.to));
        if (params.days) q.set("days", String(params.days));
        return req<ApiList<{ cohort: string; size: number; values: number[] }>>(
            `/projects/${id}/analytics/retention?${q}`,
        );
    },
};

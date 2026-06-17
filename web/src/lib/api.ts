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
export interface EventDefinition {
    id: number;
    name: string;
    display_name: string;
    description: string;
    status: number;
    first_seen?: string;
    last_seen?: string;
}
export interface PropertyDefinition {
    id: number;
    name: string;
    display_name: string;
    data_type: string;
    scope: "event" | "user";
    description: string;
    status: number;
    first_seen?: string;
    last_seen?: string;
}
export interface IdentityMapping {
    id: number;
    anonymous_id: string;
    user_id: string;
    first_seen?: string;
    last_seen?: string;
    updated_at: string;
}
export interface UserProfile {
    distinct_id: string;
    user_id: string;
    anonymous_id: string;
    properties: Record<string, unknown>;
    updated_at: string;
}
export interface PropertyValueStat {
    raw: string;
    value: unknown;
    label: string;
    count: number;
    users: number;
    share: number;
}
export interface UserEvent {
    event: string;
    distinct_id: string;
    user_id: string;
    anonymous_id: string;
    time: string;
    lib: string;
    os: string;
    properties: Record<string, unknown>;
}
export interface QueryDimension {
    type: "event" | "property";
    key: string;
}
export interface QueryFilter {
    event?: string;
    property?: string;
    op?: "eq" | "neq" | "exists";
    value?: unknown;
}
export interface QueryTableRow {
    dimensions: {
        type: "event" | "property";
        key: string;
        raw: string;
        label: string;
        value: unknown;
    }[];
    count: number;
    users: number;
}
export interface ConversionGoal {
    id: number;
    project_id: number;
    name: string;
    description: string;
    events: string[];
    window_seconds: number;
    breakdown_property: string;
    status: number;
    created_at: string;
    updated_at: string;
}
export interface ConversionStep {
    event: string;
    users: number;
    conversion: number;
    dropoff: number;
}
export interface ConversionBreakdownRow {
    raw: string;
    value: unknown;
    label: string;
    steps: ConversionStep[];
    users: number;
    conversion: number;
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
    listEvents: (id: number | string) =>
        req<ApiList<EventDefinition>>(`/projects/${id}/events`),
    listProperties: (
        id: number | string,
        params?: { scope?: "event" | "user" },
    ) => {
        const q = new URLSearchParams();
        if (params?.scope) q.set("scope", params.scope);
        return req<ApiList<PropertyDefinition>>(`/projects/${id}/properties?${q}`);
    },
    listIdentities: (
        id: number | string,
        params?: { user_id?: string; anonymous_id?: string; limit?: number },
    ) => {
        const q = new URLSearchParams();
        if (params?.user_id) q.set("user_id", params.user_id);
        if (params?.anonymous_id) q.set("anonymous_id", params.anonymous_id);
        if (params?.limit) q.set("limit", String(params.limit));
        return req<ApiList<IdentityMapping>>(`/projects/${id}/identities?${q}`);
    },
    listUsers: (
        id: number | string,
        params?: { query?: string; limit?: number },
    ) => {
        const q = new URLSearchParams();
        if (params?.query) q.set("query", params.query);
        if (params?.limit) q.set("limit", String(params.limit));
        return req<ApiList<UserProfile>>(`/projects/${id}/users?${q}`);
    },
    getUserProfile: (id: number | string, distinctId: string) =>
        req<ApiOne<UserProfile>>(
            `/projects/${id}/users/${encodeURIComponent(distinctId)}/profile`,
        ),
    userEvents: (
        id: number | string,
        distinctId: string,
        params?: { from?: number; to?: number; event?: string; limit?: number },
    ) => {
        const q = new URLSearchParams();
        if (params?.from) q.set("from", String(params.from));
        if (params?.to) q.set("to", String(params.to));
        if (params?.event) q.set("event", params.event);
        if (params?.limit) q.set("limit", String(params.limit));
        return req<ApiList<UserEvent>>(
            `/projects/${id}/users/${encodeURIComponent(distinctId)}/events?${q}`,
        );
    },
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
    propertyValues: (
        id: number | string,
        params: { property: string; event?: string; from?: number; to?: number; limit?: number },
    ) => {
        const q = new URLSearchParams({ property: params.property });
        if (params.event) q.set("event", params.event);
        if (params.from) q.set("from", String(params.from));
        if (params.to) q.set("to", String(params.to));
        if (params.limit) q.set("limit", String(params.limit));
        return req<ApiList<PropertyValueStat>>(
            `/projects/${id}/analytics/property_values?${q}`,
        );
    },
    listConversionGoals: (id: number | string) =>
        req<ApiList<ConversionGoal>>(`/projects/${id}/conversion_goals`),
    createConversionGoal: (
        id: number | string,
        body: {
            name: string;
            description?: string;
            events: string[];
            window_seconds: number;
            breakdown_property?: string;
        },
    ) =>
        req<ApiOne<ConversionGoal>>(`/projects/${id}/conversion_goals`, {
            method: "POST",
            body: JSON.stringify(body),
        }),
    deleteConversionGoal: (id: number | string, goalId: number | string) =>
        req<ApiOne<{ deleted: boolean }>>(
            `/projects/${id}/conversion_goals/${goalId}`,
            { method: "DELETE" },
        ),
    conversion: (
        id: number | string,
        body: {
            events: string[];
            from?: number;
            to?: number;
            window_seconds?: number;
            breakdown_property?: string;
        },
    ) =>
        req<ApiOne<{ steps: ConversionStep[]; breakdown: ConversionBreakdownRow[] }>>(
            `/projects/${id}/analytics/conversion`,
            {
                method: "POST",
                body: JSON.stringify(body),
            },
        ),
    queryTable: (
        id: number | string,
        body: {
            events?: string[];
            from?: number;
            to?: number;
            limit?: number;
            dimensions: QueryDimension[];
            filters?: QueryFilter[];
        },
    ) =>
        req<ApiOne<{ dimensions: QueryDimension[]; rows: QueryTableRow[] }>>(
            `/projects/${id}/analytics/query_table`,
            {
                method: "POST",
                body: JSON.stringify(body),
            },
        ),
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

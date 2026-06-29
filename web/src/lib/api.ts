// API client：统一指向 Go API 服务（NEXT_PUBLIC_API_BASE）

const BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8082";

function getAuthToken() {
    if (typeof window === "undefined") return "";
    try {
        const raw = localStorage.getItem("aerolog-auth");
        if (!raw) return "";
        const parsed = JSON.parse(raw) as { state?: { token?: string } };
        return parsed.state?.token || "";
    } catch {
        return "";
    }
}

function authHeaders(init?: RequestInit) {
    const token = getAuthToken();
    return {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers || {}),
    };
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${BASE}/v1${path}`, {
        ...init,
        headers: authHeaders(init),
        cache: "no-store",
    });
    const text = await res.text();
    let payload: unknown = null;
    if (text) {
        try {
            payload = JSON.parse(text);
        } catch {
            payload = null;
        }
    }
    if (!res.ok) {
        const message =
            typeof payload === "object" && payload !== null && "message" in payload
                ? String((payload as { message?: unknown }).message || "")
                : "";
        throw new Error(message || text || `HTTP ${res.status}`);
    }
    return payload as T;
}

// downloadCsv 触发浏览器下载，由后端返回 text/csv。
async function downloadCsv(path: string, init: RequestInit, filename: string): Promise<void> {
    const res = await fetch(`${BASE}/v1${path}`, {
        ...init,
        headers: authHeaders(init),
        cache: "no-store",
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export interface Project {
    id: number;
    company_id: number;
    company_name: string;
    name: string;
    app_type: "web" | "android" | "ios" | "mini_program" | "server" | "other";
    package_name: string;
    token: string;
    description: string;
    require_signature: boolean;
    status: ProjectStatus;
    role?: "owner" | "editor" | "viewer";
    created_at: string;
}
export type ProjectStatus = 0 | 1 | 2 | 3;
export interface AuthUser {
    id: number;
    email: string;
    name: string;
    phone: string;
    job_title: string;
    company_id: number;
    company_name: string;
    role: "admin" | "platform_member" | "company_admin" | "member";
    status: number;
    created_at: string;
}
export interface AuthPayload {
    token: string;
    user: AuthUser;
}
export interface ProjectMember {
    id: number;
    project_id: number;
    user_id: number;
    email: string;
    name: string;
    role: "owner" | "editor" | "viewer";
    created_at: string;
    updated_at: string;
}
export interface Company {
    id: number;
    name: string;
    industry: string;
    contact_name: string;
    contact_phone: string;
    status: number;
    created_at: string;
}
export interface MemberAccount {
    id: number;
    email: string;
    name: string;
    phone: string;
    job_title: string;
    role: "admin" | "platform_member" | "company_admin" | "member";
    company_id: number;
    company_name: string;
    project_count: number;
    project_names: string;
    is_company_admin: boolean;
    status: number;
    created_at: string;
}
export interface MemberProjectGrant {
    project_id: number;
    project_name: string;
    role: ProjectMember["role"];
}
export interface EventDefinition {
    id: number;
    name: string;
    display_name: string;
    description: string;
    schema_required_props: string[];
    schema_locked: boolean;
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
    event: string;
    description: string;
    schema_required: boolean;
    schema_locked: boolean;
    enum_values: string[];
    status: number;
    owner: string;
    archived: boolean;
    hidden: boolean;
    first_seen?: string;
    last_seen?: string;
}
export interface PropertyChangeLogEntry {
    id: number;
    project_id: number;
    property_name: string;
    scope: "event" | "user";
    event: string;
    change_type: string;
    actor: string;
    note: string;
    before_value?: Record<string, unknown>;
    after_value?: Record<string, unknown>;
    created_at: string;
}
export interface DebugEvent {
    id: number;
    project_id: number;
    event: string;
    event_type: string;
    distinct_id: string;
    user_id: string;
    anonymous_id: string;
    result: "accepted" | "schema_warning" | "rejected";
    reason: string;
    payload: Record<string, unknown>;
    received_at?: string;
    created_at: string;
}
export interface SchemaIssue {
    id: number;
    event: string;
    property: string;
    expected_type: string;
    actual_type: string;
    severity: "warning" | "error";
    message: string;
    payload: Record<string, unknown>;
    observed_at?: string;
    created_at: string;
}
export interface SchemaIssueGroup {
    id: number;
    event: string;
    property: string;
    expected_type: string;
    actual_type: string;
    severity: "warning" | "error";
    message: string;
    fingerprint: string;
    count: number;
    sample_payload: Record<string, unknown>;
    first_seen?: string;
    last_seen?: string;
    created_at: string;
    updated_at: string;
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
    sample_users: string[];
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
    version: number;
    created_at: string;
    updated_at: string;
}
export interface ConversionGoalVersion {
    id: number;
    goal_id: number;
    version: number;
    name: string;
    description: string;
    events: string[];
    window_seconds: number;
    breakdown_property: string;
    note: string;
    created_at: string;
}
export interface ConversionTrendPoint {
    bucket: string;
    first: number;
    last: number;
    conversion: number;
}
export interface QueryTemplate {
    id: number;
    project_id: number;
    name: string;
    description: string;
    config: Record<string, unknown>;
    share_token?: string;
    is_shared: boolean;
    status: number;
    created_at: string;
    updated_at: string;
}
export interface AnalyticsJob {
    id: number;
    project_id: number;
    type: string;
    status: "pending" | "running" | "succeeded" | "failed";
    input: Record<string, unknown>;
    result?: {
        format?: string;
        filename?: string;
        download_url?: string;
        dimensions?: QueryDimension[];
        rows?: QueryTableRow[];
    };
    error_message?: string;
    rows_count: number;
    created_at: string;
    updated_at: string;
    finished_at?: string;
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
export interface RetentionCohort {
    cohort: string;
    size: number;
    values: number[];
}
export interface RetentionBreakdownGroup {
    raw: string;
    value: unknown;
    label: string;
    rows: RetentionCohort[];
    total_size: number;
    day_one: number;
}
export interface AttributionRow {
    event: string;
    credit: number;
    users: number;
    share: number;
    avg_lag_seconds: number;
}
export interface AttributionLagBucket {
    key: string;
    label: string;
    credit: number;
    users: number;
    share: number;
}
export interface AttributionBreakdownGroup {
    raw: string;
    value: unknown;
    label: string;
    total_credit: number;
    users: number;
    top_event: string;
    top_share: number;
    rows: AttributionRow[];
}
export interface ApiList<T> {
    code: number;
    message: string;
    data: T[];
}
export interface ApiOne<T> {
    code: number;
    message: string;
    data: T;
}

// 注意：from / to 统一使用毫秒（ms）时间戳，与 Go API 一致。
export const api = {
    login: (body: { email: string; password: string }) =>
        req<ApiOne<AuthPayload>>("/auth/login", {
            method: "POST",
            body: JSON.stringify(body),
        }),
    register: (body: {
        email: string;
        name?: string;
        password: string;
        phone?: string;
        job_title?: string;
        company_name: string;
        company_industry?: string;
        company_phone?: string;
    }) =>
        req<ApiOne<AuthPayload>>("/auth/register", {
            method: "POST",
            body: JSON.stringify(body),
        }),
    me: () => req<ApiOne<AuthUser>>("/auth/me"),
    logout: () => req<ApiOne<{ ok: boolean }>>("/auth/logout", { method: "POST" }),
    listCompanies: () => req<ApiList<Company>>("/companies"),
    listMembers: () => req<ApiList<MemberAccount>>("/members"),
    createMemberAccount: (body: {
        account_type?: "platform_admin" | "platform_member" | "enterprise_admin" | "enterprise_member";
        email: string;
        name?: string;
        password: string;
        phone?: string;
        job_title?: string;
        company_id?: number;
        company_name?: string;
        company_industry?: string;
        company_phone?: string;
        project_ids?: number[];
        project_role?: ProjectMember["role"];
    }) =>
        req<ApiOne<{ id: number; email: string; company_id: number; role: AuthUser["role"] }>>("/members", {
            method: "POST",
            body: JSON.stringify(body),
        }),
    listMemberProjects: (id: number | string) =>
        req<ApiList<MemberProjectGrant>>(`/members/${id}/projects`),
    updateMemberAccount: (
        id: number | string,
        body: { name?: string; email?: string; status?: 0 | 1 },
    ) =>
        req<ApiOne<{ id: number }>>(`/members/${id}`, {
            method: "PATCH",
            body: JSON.stringify(body),
        }),
    updateMemberProjects: (
        id: number | string,
        body: { projects: Array<{ project_id: number; role: ProjectMember["role"] }> },
    ) =>
        req<ApiList<MemberProjectGrant>>(`/members/${id}/projects`, {
            method: "PUT",
            body: JSON.stringify(body),
        }),
    listProjects: () => req<ApiList<Project>>("/projects"),
    createProject: (body: {
        name: string;
        company_id?: number;
        app_type?: Project["app_type"];
        package_name?: string;
        description?: string;
        status?: ProjectStatus;
    }) =>
        req<ApiOne<{
            id: number;
            company_id: number;
            name: string;
            app_type: Project["app_type"];
            package_name: string;
            token: string;
            require_signature: boolean;
            status: ProjectStatus;
        }>>("/projects", {
            method: "POST",
            body: JSON.stringify(body),
        }),
    getProject: (id: number | string) => req<ApiOne<Project>>(`/projects/${id}`),
    updateProjectSecurity: (
        id: number | string,
        body: { require_signature: boolean },
    ) =>
        req<ApiOne<Project>>(`/projects/${id}/security`, {
            method: "PATCH",
            body: JSON.stringify(body),
        }),
    updateProjectStatus: (
        id: number | string,
        body: { status: ProjectStatus },
    ) =>
        req<ApiOne<Project>>(`/projects/${id}/status`, {
            method: "PATCH",
            body: JSON.stringify(body),
        }),
    listProjectMembers: (id: number | string) =>
        req<ApiList<ProjectMember>>(`/projects/${id}/members`),
    addProjectMember: (
        id: number | string,
        body: { email: string; role: ProjectMember["role"] },
    ) =>
        req<ApiOne<ProjectMember>>(`/projects/${id}/members`, {
            method: "POST",
            body: JSON.stringify(body),
        }),
    updateProjectMember: (
        id: number | string,
        userId: number | string,
        body: { role: ProjectMember["role"] },
    ) =>
        req<ApiOne<ProjectMember>>(`/projects/${id}/members/${userId}`, {
            method: "PATCH",
            body: JSON.stringify(body),
        }),
    deleteProjectMember: (id: number | string, userId: number | string) =>
        req<ApiOne<{ deleted: boolean }>>(`/projects/${id}/members/${userId}`, {
            method: "DELETE",
        }),
    listEvents: (id: number | string) =>
        req<ApiList<EventDefinition>>(`/projects/${id}/events`),
    updateEventSchema: (
        id: number | string,
        event: string,
        body: {
            schema_required_props: string[];
            status?: number;
            display_name?: string;
            description?: string;
        },
    ) =>
        req<ApiOne<EventDefinition>>(
            `/projects/${id}/events/${encodeURIComponent(event)}/schema`,
            {
                method: "PUT",
                body: JSON.stringify(body),
            },
        ),
    listProperties: (
        id: number | string,
        params?: {
            scope?: "event" | "user";
            event?: string;
            include_global?: boolean;
            include_archived?: boolean;
            include_hidden?: boolean;
        },
    ) => {
        const q = new URLSearchParams();
        if (params?.scope) q.set("scope", params.scope);
        if (params?.event) q.set("event", params.event);
        if (params?.include_global) q.set("include_global", "1");
        if (params?.include_archived) q.set("include_archived", "1");
        if (params?.include_hidden) q.set("include_hidden", "1");
        return req<ApiList<PropertyDefinition>>(`/projects/${id}/properties?${q}`);
    },
    updatePropertySchema: (
        id: number | string,
        property: string,
        body: {
            scope?: "event" | "user";
            event?: string;
            data_type: string;
            schema_required?: boolean;
            enum_values?: string[];
            display_name?: string;
            description?: string;
            owner?: string;
            archived?: boolean;
            hidden?: boolean;
            actor?: string;
            note?: string;
        },
    ) =>
        req<ApiOne<PropertyDefinition>>(
            `/projects/${id}/properties/${encodeURIComponent(property)}/schema`,
            {
                method: "PUT",
                body: JSON.stringify(body),
            },
        ),
    batchUpdateProperties: (
        id: number | string,
        body: {
            actor?: string;
            note?: string;
            change_type?: string;
            items: {
                name: string;
                scope: "event" | "user";
                event?: string;
                owner?: string;
                archived?: boolean;
                hidden?: boolean;
            }[];
        },
    ) =>
        req<ApiOne<{ updated: number }>>(`/projects/${id}/properties/batch`, {
            method: "PUT",
            body: JSON.stringify(body),
        }),
    propertyChangeLog: (
        id: number | string,
        property: string,
        params?: { scope?: "event" | "user"; event?: string; limit?: number },
    ) => {
        const q = new URLSearchParams();
        if (params?.scope) q.set("scope", params.scope);
        if (params?.event) q.set("event", params.event);
        if (params?.limit) q.set("limit", String(params.limit));
        return req<ApiList<PropertyChangeLogEntry>>(
            `/projects/${id}/properties/${encodeURIComponent(property)}/change_log?${q}`,
        );
    },
    debugEvents: (
        id: number | string,
        params?: { event?: string; result?: string; distinct_id?: string; limit?: number; include_global?: boolean },
    ) => {
        const q = new URLSearchParams();
        if (params?.event) q.set("event", params.event);
        if (params?.result) q.set("result", params.result);
        if (params?.distinct_id) q.set("distinct_id", params.distinct_id);
        if (params?.limit) q.set("limit", String(params.limit));
        if (params?.include_global) q.set("include_global", "1");
        return req<ApiList<DebugEvent>>(`/projects/${id}/debug/events?${q}`);
    },
    schemaIssues: (
        id: number | string,
        params?: { event?: string; property?: string; limit?: number },
    ) => {
        const q = new URLSearchParams();
        if (params?.event) q.set("event", params.event);
        if (params?.property) q.set("property", params.property);
        if (params?.limit) q.set("limit", String(params.limit));
        return req<ApiList<SchemaIssue>>(`/projects/${id}/debug/schema_issues?${q}`);
    },
    schemaIssueGroups: (
        id: number | string,
        params?: { event?: string; property?: string; limit?: number },
    ) => {
        const q = new URLSearchParams();
        if (params?.event) q.set("event", params.event);
        if (params?.property) q.set("property", params.property);
        if (params?.limit) q.set("limit", String(params.limit));
        return req<ApiList<SchemaIssueGroup>>(
            `/projects/${id}/debug/schema_issue_groups?${q}`,
        );
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
        params?: { from?: number; to?: number; event?: string; limit?: number; merge_identity?: boolean },
    ) => {
        const q = new URLSearchParams();
        if (params?.from) q.set("from", String(params.from));
        if (params?.to) q.set("to", String(params.to));
        if (params?.event) q.set("event", params.event);
        if (params?.limit) q.set("limit", String(params.limit));
        if (params?.merge_identity === false) q.set("merge_identity", "false");
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
            note?: string;
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
    listConversionGoalVersions: (id: number | string, goalId: number | string) =>
        req<ApiList<ConversionGoalVersion>>(
            `/projects/${id}/conversion_goals/${goalId}/versions`,
        ),
    conversionTrend: (
        id: number | string,
        body: {
            events: string[];
            from?: number;
            to?: number;
            window_seconds?: number;
            compare_from?: number;
            compare_to?: number;
            interval?: "hour" | "day";
        },
    ) =>
        req<
            ApiOne<{
                current: ConversionTrendPoint[];
                compare: ConversionTrendPoint[];
                interval: "hour" | "day";
            }>
        >(`/projects/${id}/analytics/conversion_trend`, {
            method: "POST",
            body: JSON.stringify(body),
        }),
    conversionExport: (
        id: number | string,
        body: {
            events: string[];
            from?: number;
            to?: number;
            window_seconds?: number;
            breakdown_property?: string;
        },
        filename = "conversion_breakdown.csv",
    ) =>
        downloadCsv(
            `/projects/${id}/analytics/conversion_export`,
            { method: "POST", body: JSON.stringify(body) },
            filename,
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
    queryTableExport: (
        id: number | string,
        body: {
            events?: string[];
            from?: number;
            to?: number;
            limit?: number;
            dimensions: QueryDimension[];
            filters?: QueryFilter[];
        },
        filename = "query_table.csv",
    ) =>
        downloadCsv(
            `/projects/${id}/analytics/query_table/export`,
            { method: "POST", body: JSON.stringify(body) },
            filename,
        ),
    listQueryTemplates: (id: number | string) =>
        req<ApiList<QueryTemplate>>(`/projects/${id}/query_templates`),
    createQueryTemplate: (
        id: number | string,
        body: { name: string; description?: string; config: Record<string, unknown>; is_shared?: boolean },
    ) =>
        req<ApiOne<QueryTemplate>>(`/projects/${id}/query_templates`, {
            method: "POST",
            body: JSON.stringify(body),
        }),
    updateQueryTemplate: (
        id: number | string,
        tid: number | string,
        body: { name: string; description?: string; config: Record<string, unknown> },
    ) =>
        req<ApiOne<QueryTemplate>>(`/projects/${id}/query_templates/${tid}`, {
            method: "PUT",
            body: JSON.stringify(body),
        }),
    deleteQueryTemplate: (id: number | string, tid: number | string) =>
        req<ApiOne<{ ok: boolean }>>(`/projects/${id}/query_templates/${tid}`, {
            method: "DELETE",
        }),
    shareQueryTemplate: (
        id: number | string,
        tid: number | string,
        enable: boolean,
    ) =>
        req<ApiOne<QueryTemplate>>(`/projects/${id}/query_templates/${tid}/share`, {
            method: "POST",
            body: JSON.stringify({ enable }),
        }),
    getSharedQueryTemplate: (token: string) =>
        req<ApiOne<QueryTemplate>>(`/shared/query_templates/${encodeURIComponent(token)}`),
    createAnalyticsJob: (
        id: number | string,
        body: { type: "query_export"; input: Record<string, unknown> },
    ) =>
        req<ApiOne<AnalyticsJob>>(`/projects/${id}/analytics/jobs`, {
            method: "POST",
            body: JSON.stringify(body),
        }),
    listAnalyticsJobs: (id: number | string) =>
        req<ApiList<AnalyticsJob>>(`/projects/${id}/analytics/jobs`),
    getAnalyticsJob: (id: number | string, jobId: number | string) =>
        req<ApiOne<AnalyticsJob>>(`/projects/${id}/analytics/jobs/${jobId}`),
    downloadAnalyticsJob: (id: number | string, jobId: number | string, filename = "query_export.csv") =>
        downloadCsv(`/projects/${id}/analytics/jobs/${jobId}/download`, { method: "GET" }, filename),
    funnel: (
        id: number | string,
        body: {
            events: string[];
            from?: number;
            to?: number;
            window_seconds?: number;
            breakdown_property?: string;
        },
    ) =>
        req<
            ApiOne<{
                steps: ConversionStep[];
                breakdown: ConversionBreakdownRow[];
                breakdown_truncated: boolean;
            }>
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
            breakdown_property?: string;
        },
    ) => {
        const q = new URLSearchParams({
            initial_event: params.initial_event,
            return_event: params.return_event,
        });
        if (params.from) q.set("from", String(params.from));
        if (params.to) q.set("to", String(params.to));
        if (params.days) q.set("days", String(params.days));
        if (params.breakdown_property) q.set("breakdown_property", params.breakdown_property);
        return req<
            ApiOne<{
                overall: RetentionCohort[];
                breakdown: RetentionBreakdownGroup[];
            }>
        >(`/projects/${id}/analytics/retention?${q}`);
    },
    attribution: (
        id: number | string,
        body: {
            conversion_event: string;
            touch_events: string[];
            from?: number;
            to?: number;
            window_seconds?: number;
            model?: "first" | "last" | "linear";
            breakdown_property?: string;
        },
    ) =>
        req<
            ApiOne<{
                model: "first" | "last" | "linear";
                total_users: number;
                attributed_users: number;
                unattributed_users: number;
                unattributed_share: number;
                total_credit: number;
                window_seconds: number;
                breakdown_property: string;
                breakdown_truncated: boolean;
                rows: AttributionRow[];
                lag_buckets: AttributionLagBucket[];
                breakdown: AttributionBreakdownGroup[];
            }>
        >(`/projects/${id}/analytics/attribution`, {
            method: "POST",
            body: JSON.stringify(body),
        }),
};

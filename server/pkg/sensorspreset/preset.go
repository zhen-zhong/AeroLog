// Package sensorspreset 提供神策预置事件、预置属性的标准名称与中文显示名。
package sensorspreset

// Property 描述一个神策预置属性。
type Property struct {
	Name        string
	DisplayName string
	DataType    string
}

var eventDisplayNames = map[string]string{
	"$AppStart":                 "App 启动",
	"$AppEnd":                   "App 退出",
	"$AppViewScreen":            "App 浏览页面",
	"$AppClick":                 "App 元素点击",
	"$AppInstall":               "App 激活",
	"AppInstall":                "App 激活",
	"AppCrashed":                "App 崩溃",
	"$AppStartPassively":        "App 被动启动",
	"$AppRemoteConfigChanged":   "远程控制配置变化",
	"$AppDeeplinkLaunch":        "深度链接唤醒 App",
	"$AppDeeplinkMatchedResult": "深度链接匹配结果",
	"$AppPushClick":             "App 推送点击",
	"$ABTestTrigger":            "A/B 测试",
	"$AppPageLeave":             "页面离开",
}

var properties = []Property{
	{Name: "$app_id", DisplayName: "应用唯一标识", DataType: "string"},
	{Name: "$app_name", DisplayName: "应用名称", DataType: "string"},
	{Name: "$app_version", DisplayName: "应用版本", DataType: "string"},
	{Name: "$lib", DisplayName: "SDK 类型", DataType: "string"},
	{Name: "$lib_version", DisplayName: "SDK 版本", DataType: "string"},
	{Name: "$lib_plugin_version", DisplayName: "SDK 插件版本号", DataType: "list"},
	{Name: "$manufacturer", DisplayName: "设备制造商", DataType: "string"},
	{Name: "$brand", DisplayName: "设备品牌", DataType: "string"},
	{Name: "$model", DisplayName: "设备型号", DataType: "string"},
	{Name: "$os", DisplayName: "操作系统", DataType: "string"},
	{Name: "$os_version", DisplayName: "操作系统版本", DataType: "string"},
	{Name: "$screen_height", DisplayName: "屏幕高度", DataType: "number"},
	{Name: "$screen_width", DisplayName: "屏幕宽度", DataType: "number"},
	{Name: "$wifi", DisplayName: "是否 WiFi", DataType: "bool"},
	{Name: "$carrier", DisplayName: "运营商名称", DataType: "string"},
	{Name: "$network_type", DisplayName: "网络类型", DataType: "string"},
	{Name: "$timezone_offset", DisplayName: "时区偏移量", DataType: "number"},
	{Name: "$is_first_day", DisplayName: "是否首日访问", DataType: "bool"},
	{Name: "$is_first_time", DisplayName: "是否首次", DataType: "bool"},
	{Name: "$resume_from_background", DisplayName: "是否从后台唤醒", DataType: "bool"},
	{Name: "$is_login_id", DisplayName: "是否登录 ID", DataType: "bool"},
	{Name: "$ip", DisplayName: "IP", DataType: "string"},
	{Name: "$country", DisplayName: "国家", DataType: "string"},
	{Name: "$province", DisplayName: "省份", DataType: "string"},
	{Name: "$city", DisplayName: "城市", DataType: "string"},
	{Name: "$device_id", DisplayName: "设备 ID", DataType: "string"},
	{Name: "$screen_orientation", DisplayName: "屏幕方向", DataType: "string"},
	{Name: "$latitude", DisplayName: "纬度", DataType: "number"},
	{Name: "$longitude", DisplayName: "经度", DataType: "number"},
	{Name: "$geo_coordinate_system", DisplayName: "坐标系", DataType: "string"},
	{Name: "$anonymization_id", DisplayName: "匿名化 ID", DataType: "string"},
	{Name: "$channel_device_info", DisplayName: "渠道匹配设备信息", DataType: "string"},
	{Name: "$is_channel_callback_event", DisplayName: "是否进行渠道匹配回调", DataType: "bool"},
	{Name: "$screen_name", DisplayName: "页面名称", DataType: "string"},
	{Name: "$title", DisplayName: "页面标题", DataType: "string"},
	{Name: "$url", DisplayName: "页面地址", DataType: "string"},
	{Name: "$referrer", DisplayName: "前向地址", DataType: "string"},
	{Name: "$referrer_title", DisplayName: "前向页面标题", DataType: "string"},
	{Name: "$event_duration", DisplayName: "事件时长", DataType: "number"},
	{Name: "$app_crashed_reason", DisplayName: "崩溃原因", DataType: "string"},
	{Name: "app_crashed_reason", DisplayName: "崩溃原因", DataType: "string"},
}

var propertyByName = func() map[string]Property {
	result := make(map[string]Property, len(properties))
	for _, property := range properties {
		result[property.Name] = property
	}
	return result
}()

var commonPropertyNames = []string{
	"$app_id", "$app_name", "$app_version", "$lib", "$lib_version", "$lib_plugin_version",
	"$manufacturer", "$brand", "$model", "$os", "$os_version", "$screen_height", "$screen_width",
	"$wifi", "$carrier", "$network_type", "$timezone_offset", "$is_first_day", "$is_login_id",
	"$ip", "$country", "$province", "$city", "$device_id", "$screen_orientation", "$latitude",
	"$longitude", "$geo_coordinate_system", "$anonymization_id", "$channel_device_info",
	"$is_channel_callback_event",
}

var eventPropertyNames = map[string][]string{
	"$AppStart":      {"$is_first_time", "$resume_from_background", "$screen_name", "$title"},
	"$AppEnd":        {"$event_duration", "$screen_name", "$title"},
	"$AppViewScreen": {"$screen_name", "$title", "$url", "$referrer", "$referrer_title"},
	"$AppPageLeave":  {"$event_duration", "$screen_name", "$title", "$url", "$referrer"},
	"AppCrashed":     {"$app_crashed_reason", "app_crashed_reason"},
}

// EventDisplayName 返回神策预置事件中文名。未知事件返回空字符串。
func EventDisplayName(name string) string {
	return eventDisplayNames[name]
}

// PropertyDisplayName 返回神策预置属性中文名。未知属性返回空字符串。
func PropertyDisplayName(name string) string {
	return propertyByName[name].DisplayName
}

// Properties 返回预置属性副本，调用方可安全修改。
func Properties() []Property {
	result := make([]Property, len(properties))
	copy(result, properties)
	return result
}

// PropertiesForEvent 返回某事件适用的通用与事件专属预置属性。
func PropertiesForEvent(event string) []Property {
	names := append([]string{}, commonPropertyNames...)
	names = append(names, eventPropertyNames[event]...)
	result := make([]Property, 0, len(names))
	seen := make(map[string]struct{}, len(names))
	for _, name := range names {
		if _, ok := seen[name]; ok {
			continue
		}
		property, ok := propertyByName[name]
		if !ok {
			continue
		}
		seen[name] = struct{}{}
		result = append(result, property)
	}
	return result
}

package sensorspreset

import "testing"

func TestPresetNames(t *testing.T) {
	if got := EventDisplayName("AppCrashed"); got != "App 崩溃" {
		t.Fatalf("EventDisplayName(AppCrashed) = %q", got)
	}
	if got := EventDisplayName("$AppCrashed"); got != "" {
		t.Fatalf("$AppCrashed 不是神策标准事件名，got %q", got)
	}
	if got := PropertyDisplayName("$os"); got != "操作系统" {
		t.Fatalf("PropertyDisplayName($os) = %q", got)
	}
}

func TestPropertiesReturnsCopy(t *testing.T) {
	first := Properties()
	first[0].DisplayName = "changed"
	if Properties()[0].DisplayName == "changed" {
		t.Fatal("Properties 必须返回副本")
	}
}

func TestPropertiesForEvent(t *testing.T) {
	viewNames := map[string]bool{}
	for _, property := range PropertiesForEvent("$AppViewScreen") {
		viewNames[property.Name] = true
	}
	for _, name := range []string{"$os", "$app_id", "$channel_device_info", "$screen_name", "$url"} {
		if !viewNames[name] {
			t.Fatalf("$AppViewScreen 缺少预置属性 %s", name)
		}
	}
	if viewNames["$app_crashed_reason"] {
		t.Fatal("$AppViewScreen 不应包含崩溃原因")
	}
}

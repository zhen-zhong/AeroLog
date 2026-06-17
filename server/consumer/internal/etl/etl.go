// Package etl 负责事件富化：UA / IP / Schema 校验
package etl

import (
	"regexp"
	"strings"
)

// UA 极简解析。生产建议使用 ua-parser/uap-go，并加载官方 yaml。
type UA struct {
	OS         string
	OSVersion  string
	Browser    string
	BrowserVer string
	Device     string
}

var (
	reChrome  = regexp.MustCompile(`Chrome/([\d.]+)`)
	reFirefox = regexp.MustCompile(`Firefox/([\d.]+)`)
	reSafari  = regexp.MustCompile(`Version/([\d.]+).+Safari/`)
	reEdge    = regexp.MustCompile(`Edg/([\d.]+)`)
	reIOS     = regexp.MustCompile(`OS ([\d_]+) like Mac`)
	reAndroid = regexp.MustCompile(`Android ([\d.]+)`)
	reMac     = regexp.MustCompile(`Mac OS X ([\d_]+)`)
	reWin     = regexp.MustCompile(`Windows NT ([\d.]+)`)
)

// ParseUA 极简实现：在 Consumer 初版可用，后续替换。
func ParseUA(ua string) UA {
	out := UA{}
	switch {
	case strings.Contains(ua, "Edg/"):
		if m := reEdge.FindStringSubmatch(ua); len(m) == 2 {
			out.Browser, out.BrowserVer = "Edge", m[1]
		}
	case strings.Contains(ua, "Chrome/"):
		if m := reChrome.FindStringSubmatch(ua); len(m) == 2 {
			out.Browser, out.BrowserVer = "Chrome", m[1]
		}
	case strings.Contains(ua, "Firefox/"):
		if m := reFirefox.FindStringSubmatch(ua); len(m) == 2 {
			out.Browser, out.BrowserVer = "Firefox", m[1]
		}
	case strings.Contains(ua, "Safari/"):
		if m := reSafari.FindStringSubmatch(ua); len(m) == 2 {
			out.Browser, out.BrowserVer = "Safari", m[1]
		}
	}
	switch {
	case strings.Contains(ua, "Windows NT"):
		out.OS = "Windows"
		if m := reWin.FindStringSubmatch(ua); len(m) == 2 {
			out.OSVersion = m[1]
		}
	case strings.Contains(ua, "Mac OS X"):
		out.OS = "macOS"
		if m := reMac.FindStringSubmatch(ua); len(m) == 2 {
			out.OSVersion = strings.ReplaceAll(m[1], "_", ".")
		}
	case strings.Contains(ua, "Android"):
		out.OS = "Android"
		if m := reAndroid.FindStringSubmatch(ua); len(m) == 2 {
			out.OSVersion = m[1]
		}
	case strings.Contains(ua, "iPhone") || strings.Contains(ua, "iPad"):
		out.OS = "iOS"
		if m := reIOS.FindStringSubmatch(ua); len(m) == 2 {
			out.OSVersion = strings.ReplaceAll(m[1], "_", ".")
		}
	}
	return out
}

// GeoLookup 占位：生产请接入 ip2region / MaxMind。
type Geo struct {
	Country  string
	Province string
	City     string
}

// ResolveGeo 占位实现：本地局域网或解析失败返回空。
func ResolveGeo(ip string) Geo {
	if ip == "" || strings.HasPrefix(ip, "10.") || strings.HasPrefix(ip, "192.168.") || ip == "127.0.0.1" {
		return Geo{}
	}
	// TODO: 接入 ip2region/xdb
	return Geo{}
}

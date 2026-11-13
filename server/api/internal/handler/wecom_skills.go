package handler

import (
	"context"
	"errors"
	"strings"

	"github.com/gin-gonic/gin"
)

// WeComSkillDefinition 是固定只读机器人能力的元数据。
// 新增 Skill 在此注册，无需修改消息传输层。
type WeComSkillDefinition struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Aliases     []string `json:"aliases"`
}

type wecomSkill struct {
	definition WeComSkillDefinition
	match      func(question string) bool
	execute    func(ctx context.Context, input wecomSkillInput) (gin.H, error)
}

// wecomSkillInput 只承载已校验的固定 Skill 与有限参数。
type wecomSkillInput struct {
	Question string
	Params   wecomBotSkillParams
}

func (h *WeComBotHandler) registeredSkills() []wecomSkill {
	return []wecomSkill{
		{definition: WeComSkillDefinition{Name: "directory_usage_detail", Description: "查询白名单目录的一级子项占用", Aliases: []string{"/usr", "/opt", "/var/lib/docker", "目录里"}}, match: matchesAny("/usr", "/opt", "/var/lib/docker", "/var/lib/aerolog", "/var/log", "/var/cache", "/tmp", "/home"), execute: h.executeDirectoryUsageDetail},
		{definition: WeComSkillDefinition{Name: "directory_usage", Description: "查询服务器白名单目录的占用空间", Aliases: []string{"目录", "哪些占用", "占用空间"}}, match: matchesAny("目录", "哪些占用", "占用空间"), execute: h.executeDirectoryUsage},
		{definition: WeComSkillDefinition{Name: "disk_usage", Description: "查询服务器各挂载点磁盘空间占用", Aliases: []string{"磁盘", "磁碟", "空间占用", "磁盘占用"}}, match: matchesAny("磁盘", "磁碟", "空间占用", "磁盘占用"), execute: h.executeDiskUsage},
		{definition: WeComSkillDefinition{Name: "server_status", Description: "查询服务器资源和核心服务存活状态", Aliases: []string{"服务器", "主机", "server"}}, match: matchesAny("服务器", "主机", "server"), execute: h.executeServerStatus},
		{definition: WeComSkillDefinition{Name: "kafka_status", Description: "查询神策 Kafka 消费者、lag 和死信队列", Aliases: []string{"kafka", "消息队列", "积压", "dlq"}}, match: matchesAny("kafka", "消息队列", "积压", "dlq"), execute: h.executeKafkaStatus},
		{definition: WeComSkillDefinition{Name: "funnel_summary", Description: "查询项目指定事件的顺序漏斗", Aliases: []string{"漏斗", "转化路径", "转化率"}}, match: matchesAny("漏斗", "转化路径", "转化率"), execute: h.executeFunnelSummary},
		{definition: WeComSkillDefinition{Name: "event_property_breakdown", Description: "查询事件属性取值的次数和去重用户拆解", Aliases: []string{"属性拆解", "参数拆解", "按属性", "按参数"}}, match: matchesAny("属性拆解", "参数拆解", "按属性", "按参数"), execute: h.executeEventPropertyBreakdown},
		{definition: WeComSkillDefinition{Name: "event_metrics", Description: "查询指定事件的总次数和去重用户数", Aliases: []string{"事件次数", "去重用户", "事件数据"}}, match: matchesAny("事件次数", "去重用户", "事件数据"), execute: h.executeEventMetrics},
		{definition: WeComSkillDefinition{Name: "ads_summary", Description: "查询项目广告事件汇总", Aliases: []string{"广告", "ad_show", "广告数据"}}, match: matchesAny("广告", "ad_show", "广告数据"), execute: h.executeAdsSummary},
		{definition: WeComSkillDefinition{Name: "report_trend", Description: "查询核心指标趋势图", Aliases: []string{"新增用户", "广告展示", "人均广告展示", "广告收入", "金币"}}, match: matchesAny("新增用户", "广告展示", "人均广告展示", "广告收入", "金币"), execute: h.executeReportTrend},
		{definition: WeComSkillDefinition{Name: "retention_trend", Description: "查询新用户留存趋势图", Aliases: []string{"留存", "次日留存", "day1"}}, match: matchesAny("留存", "次日留存", "day1"), execute: h.executeRetentionTrend},
	}
}

func matchesAny(words ...string) func(string) bool {
	return func(question string) bool {
		lower := strings.ToLower(question)
		for _, word := range words {
			if strings.Contains(lower, strings.ToLower(word)) {
				return true
			}
		}
		return false
	}
}

func (h *WeComBotHandler) executeSkill(ctx context.Context, request wecomBotQuery) (gin.H, error) {
	input := wecomSkillInput{Question: request.Question, Params: request.Params}
	for _, skill := range h.registeredSkills() {
		if request.Skill != "" {
			if request.Skill == skill.definition.Name {
				return skill.execute(ctx, input)
			}
			continue
		}
		if skill.match(request.Question) {
			return skill.execute(ctx, input)
		}
	}
	if request.Skill != "" {
		return nil, errors.New("不支持的 Skill")
	}
	return nil, errors.New("未匹配可用 Skill；可查询服务器状态、Kafka 状态或项目广告数据")
}

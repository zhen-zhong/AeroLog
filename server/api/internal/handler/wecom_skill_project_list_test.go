package handler

import "testing"

func TestProjectListSkillMatchesProjectQuestions(t *testing.T) {
	handler := &WeComBotHandler{}
	for _, skill := range handler.registeredSkills() {
		if skill.definition.Name != "project_list" {
			continue
		}
		for _, question := range []string{"现在这上面有几个项目", "项目列表", "有多少项目"} {
			if !skill.match(question) {
				t.Fatalf("project_list does not match %q", question)
			}
		}
		return
	}
	t.Fatal("project_list is not registered")
}

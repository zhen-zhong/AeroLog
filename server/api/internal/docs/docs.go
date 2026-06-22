// Package docs 嵌入并对外提供 OpenAPI 文档与 Swagger UI 静态页。
package docs

import (
	_ "embed"
	"net/http"

	"github.com/gin-gonic/gin"
)

//go:embed openapi.yaml
var openapiYAML []byte

const swaggerHTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>AeroLog API 文档</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
  <style>html,body{margin:0;padding:0;}#swagger-ui{max-width:1280px;margin:0 auto;}</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: "/swagger/openapi.yaml",
      dom_id: "#swagger-ui",
      deepLinking: true,
      docExpansion: "list",
      defaultModelsExpandDepth: -1,
      persistAuthorization: true,
    });
  </script>
</body>
</html>`

// Register 在 gin 引擎上挂 /swagger/ 系列路由。
//
//   - GET /swagger/              -> Swagger UI 页面
//   - GET /swagger/index.html    -> 同上
//   - GET /swagger/openapi.yaml  -> OpenAPI 规格文件
func Register(r gin.IRouter) {
	r.GET("/swagger/openapi.yaml", func(c *gin.Context) {
		c.Data(http.StatusOK, "application/yaml; charset=utf-8", openapiYAML)
	})
	handler := func(c *gin.Context) {
		c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(swaggerHTML))
	}
	r.GET("/swagger", handler)
	r.GET("/swagger/", handler)
	r.GET("/swagger/index.html", handler)
}

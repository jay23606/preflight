// Fails when the generated types are older than the schema they come from.
package main

import (
	"fmt"
	"os"
	"strings"
)

func main() {
	changed := strings.Split(os.Getenv("PREFLIGHT_CHANGED_FILES"), "\n")
	schemaTouched := false
	generatedTouched := false
	for _, file := range changed {
		switch strings.TrimSpace(file) {
		case "api/schema.json":
			schemaTouched = true
		case "api/types.gen.go":
			generatedTouched = true
		}
	}
	if schemaTouched && !generatedTouched {
		fmt.Fprintln(os.Stderr, "api/schema.json changed but api/types.gen.go did not")
		fmt.Fprintln(os.Stderr, "Run `go generate ./api/...` and commit the result.")
		os.Exit(1)
	}
}

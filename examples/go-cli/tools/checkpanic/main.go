// Handlers must return errors rather than panic.
package main

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func main() {
	root := os.Getenv("PREFLIGHT_ROOT")
	if root == "" {
		root, _ = os.Getwd()
	}
	found := false
	for _, rel := range os.Args[1:] {
		file, err := os.Open(filepath.Join(root, rel))
		if err != nil {
			continue
		}
		scanner := bufio.NewScanner(file)
		for line := 1; scanner.Scan(); line++ {
			text := scanner.Text()
			call := strings.Index(text, "panic(")
			if call == -1 {
				continue
			}
			// Ignore a panic that only appears inside a line comment.
			if comment := strings.Index(text, "//"); comment != -1 && comment < call {
				continue
			}
			fmt.Fprintf(os.Stderr, "%s:%d  panic in a handler: %s\n", rel, line, strings.TrimSpace(text))
			found = true
		}
		file.Close()
	}
	if found {
		fmt.Fprintln(os.Stderr, "\nReturn an error and let the middleware turn it into a 500.")
		os.Exit(1)
	}
}

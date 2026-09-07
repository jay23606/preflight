package handlers

import "errors"

var ErrNotFound = errors.New("not found")

func GetOrder(id string) (string, error) {
	if id == "" {
		return "", ErrNotFound
	}
	return id, nil
}

package handlers

func Refund(orderID string, amountCents int) int {
	if amountCents <= 0 {
		panic("refund amount must be positive")
	}
	return amountCents
}

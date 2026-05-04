package core

import (
	"encoding/json"
	"fmt"
)

// ConformanceLevel is the closed enum {core, standard, strict}. Wire form is
// the lowercase string carried at `manifest.conformance.level`.
type ConformanceLevel string

const (
	ConformanceCore     ConformanceLevel = "core"
	ConformanceStandard ConformanceLevel = "standard"
	ConformanceStrict   ConformanceLevel = "strict"
)

// String returns the wire-form spelling of the conformance level.
func (c ConformanceLevel) String() string { return string(c) }

// Valid reports whether the receiver is one of the closed-enum members.
func (c ConformanceLevel) Valid() bool {
	switch c {
	case ConformanceCore, ConformanceStandard, ConformanceStrict:
		return true
	}
	return false
}

// UnmarshalJSON enforces the closed enum at decode time so callers do not
// have to re-validate after decode. The validator package still flags the
// same condition with its full error report; this guard just keeps the typed
// surface honest.
func (c *ConformanceLevel) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return err
	}
	candidate := ConformanceLevel(s)
	if !candidate.Valid() {
		return fmt.Errorf("core: conformance.level %q outside the closed enum {core, standard, strict}", s)
	}
	*c = candidate
	return nil
}

// DeliveryMode is the closed enum {static, runtime}. Wire form lives at
// `manifest.delivery`.
type DeliveryMode string

const (
	DeliveryStatic  DeliveryMode = "static"
	DeliveryRuntime DeliveryMode = "runtime"
)

// String returns the wire-form spelling of the delivery mode.
func (d DeliveryMode) String() string { return string(d) }

// Valid reports whether the receiver is one of the closed-enum members.
func (d DeliveryMode) Valid() bool {
	switch d {
	case DeliveryStatic, DeliveryRuntime:
		return true
	}
	return false
}

// UnmarshalJSON enforces the closed enum at decode time.
func (d *DeliveryMode) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return err
	}
	candidate := DeliveryMode(s)
	if !candidate.Valid() {
		return fmt.Errorf("core: delivery %q outside the closed enum {static, runtime}", s)
	}
	*d = candidate
	return nil
}

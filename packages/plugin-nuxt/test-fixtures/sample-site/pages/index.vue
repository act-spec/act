<script setup lang="ts">
// Page SFC declaring an `act` page-level contract via the
// `defineActContract` macro form (PRD-302-R5). Used by PRD-407-R8 route
// enumeration to detect eligibility for component extraction.
defineActContract({
  type: 'landing',
  id: 'home',
  title: 'Home',
  summary: 'Marketing landing page for Acme Vue',
});
</script>

<template>
  <div>
    <h1>Acme Vue</h1>
  </div>
</template>

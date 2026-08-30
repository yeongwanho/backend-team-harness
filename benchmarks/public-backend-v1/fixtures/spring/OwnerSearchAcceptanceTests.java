package org.springframework.samples.petclinic.owner;

import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Evaluator-owned HTTP/query assertions; repository behavior is a test double. */
class OwnerSearchAcceptanceTests {

	private OwnerRepository repository;

	private MockMvc mvc;

	@BeforeEach
	void setup() {
		repository = mock(OwnerRepository.class);
		Owner first = new Owner();
		first.setId(1);
		Owner second = new Owner();
		second.setId(2);
		// Wrong queries must fail an assertion, not dereference an unstubbed null.
		when(repository.findByLastNameStartingWith(anyString(), any(Pageable.class))).thenReturn(Page.empty());
		when(repository.findByLastNameStartingWith(eq("Franklin"), any(Pageable.class)))
			.thenReturn(new PageImpl<>(List.of(first)));
		when(repository.findByLastNameStartingWith(eq(""), any(Pageable.class)))
			.thenReturn(new PageImpl<>(List.of(first, second)));
		mvc = MockMvcBuilders.standaloneSetup(new OwnerController(repository)).build();
	}

	@Test
	void surroundingWhitespaceFindsSameOwner() throws Exception {
		for (String input : List.of(" Franklin", "Franklin ", " Franklin ")) {
			clearInvocations(repository);
			mvc.perform(get("/owners").param("lastName", input))
				.andExpect(status().is3xxRedirection())
				.andExpect(view().name("redirect:/owners/1"));
			verify(repository).findByLastNameStartingWith(eq("Franklin"), any(Pageable.class));
		}
	}

	@Test
	void whitespaceOnlyUsesUnfilteredSearch() throws Exception {
		for (String input : List.of("   ", " \t\n ")) {
			clearInvocations(repository);
			mvc.perform(get("/owners").param("lastName", input))
				.andExpect(status().isOk())
				.andExpect(view().name("owners/ownersList"));
			verify(repository).findByLastNameStartingWith(eq(""), any(Pageable.class));
		}
	}

	@Test
	void emptyOrMissingNameStillListsOwners() throws Exception {
		mvc.perform(get("/owners").param("lastName", ""))
			.andExpect(status().isOk())
			.andExpect(view().name("owners/ownersList"));
		mvc.perform(get("/owners")).andExpect(status().isOk()).andExpect(view().name("owners/ownersList"));
		verify(repository, times(2)).findByLastNameStartingWith(eq(""), any(Pageable.class));
	}

	@Test
	void ordinaryNameKeepsIdentity() throws Exception {
		mvc.perform(get("/owners").param("lastName", "Franklin"))
			.andExpect(status().is3xxRedirection())
			.andExpect(view().name("redirect:/owners/1"));
		verify(repository).findByLastNameStartingWith(eq("Franklin"), any(Pageable.class));
	}

	@Test
	void internalWhitespaceAndCaseAreNotRewritten() throws Exception {
		mvc.perform(get("/owners").param("lastName", "De La Cruz"))
			.andExpect(status().isOk())
			.andExpect(view().name("owners/findOwners"));
		verify(repository).findByLastNameStartingWith(eq("De La Cruz"), any(Pageable.class));
	}

	@Test
	void unmatchedNameStaysAValidationResult() throws Exception {
		mvc.perform(get("/owners").param("lastName", "Unknown"))
			.andExpect(status().isOk())
			.andExpect(view().name("owners/findOwners"))
			.andExpect(model().attributeHasFieldErrorCode("owner", "lastName", "notFound"));
		verify(repository).findByLastNameStartingWith(eq("Unknown"), any(Pageable.class));
	}

}

package org.springframework.samples.petclinic.owner;

import java.time.LocalDate;
import java.util.Optional;
import java.util.Properties;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Evaluator-owned behavioral checks. No production implementation is supplied. */
@WebMvcTest(VisitController.class)
class VisitAcceptanceTests {

	@Autowired
	private MockMvc mvc;

	@MockitoBean
	private OwnerRepository repository;

	@BeforeEach
	void ownerWithPet() {
		Owner owner = new Owner();
		Pet pet = new Pet();
		owner.addPet(pet);
		pet.setId(1);
		given(repository.findById(1)).willReturn(Optional.of(owner));
	}

	@Test
	void rejectsTodayAndPastWithLocalizedDateError() throws Exception {
		for (int days : new int[] { 0, -1, -30 }) {
			mvc.perform(post("/owners/1/pets/1/visits/new").param("date", LocalDate.now().plusDays(days).toString())
				.param("description", "Routine visit"))
				.andExpect(status().isOk())
				.andExpect(model().attributeHasFieldErrorCode("visit", "date", "typeMismatch.visitDate"))
				.andExpect(view().name("pets/createOrUpdateVisitForm"));
		}
	}

	@Test
	void acceptsTomorrowAndLater() throws Exception {
		for (int days : new int[] { 1, 30 }) {
			mvc.perform(post("/owners/1/pets/1/visits/new").param("date", LocalDate.now().plusDays(days).toString())
				.param("description", "Routine visit"))
				.andExpect(status().is3xxRedirection())
				.andExpect(model().hasNoErrors());
		}
	}

	@Test
	void defaultsNewVisitToTomorrow() {
		assertEquals(LocalDate.now().plusDays(1), new Visit().getDate());
	}

	@Test
	void rendersTomorrowAsMinimumDate() throws Exception {
		String tomorrow = LocalDate.now().plusDays(1).toString();
		String html = mvc.perform(get("/owners/1/pets/1/visits/new"))
			.andExpect(status().isOk())
			.andReturn()
			.getResponse()
			.getContentAsString();
		assertTrue(java.util.regex.Pattern
			.compile("<input\\b(?=[^>]*\\bname=\"date\")(?=[^>]*\\bmin=\"" + tomorrow + "\")[^>]*>",
					java.util.regex.Pattern.CASE_INSENSITIVE)
			.matcher(html)
			.find(), "The rendered visit date input must reject dates before tomorrow.");
	}

	@Test
	void declaresLocalizedVisitDateMessages() throws Exception {
		for (String suffix : new String[] { "", "_de", "_es", "_fa", "_ko", "_pt", "_ru", "_tr" }) {
			try (var input = getClass().getResourceAsStream("/messages/messages" + suffix + ".properties")) {
				assertNotNull(input, "Locale resource is missing: " + suffix);
				Properties messages = new Properties();
				messages.load(input);
				assertFalse(messages.getProperty("typeMismatch.visitDate", "").isBlank(),
						"Localized date message is missing: " + suffix);
			}
		}
	}

	@Test
	void keepsDescriptionRequired() throws Exception {
		mvc.perform(post("/owners/1/pets/1/visits/new").param("date", LocalDate.now().plusDays(1).toString())
			.param("description", "")).andExpect(model().attributeHasFieldErrors("visit", "description"));
	}

}

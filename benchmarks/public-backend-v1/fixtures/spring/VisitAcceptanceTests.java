package org.springframework.samples.petclinic.owner;

import java.time.LocalDate;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Locale;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.MessageSource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.validation.BindingResult;
import org.springframework.web.servlet.i18n.SessionLocaleResolver;
import org.springframework.web.util.HtmlUtils;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Evaluator-owned behavioral checks. No production implementation is supplied. */
@WebMvcTest(VisitController.class)
class VisitAcceptanceTests {

	@Autowired
	private MockMvc mvc;

	@Autowired
	private MessageSource messages;

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
				.andExpect(model().attributeHasFieldErrors("visit", "date"))
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
	void defaultsNewVisitToTomorrow() throws Exception {
		var result = mvc.perform(get("/owners/1/pets/1/visits/new")).andExpect(status().isOk()).andReturn();
		Visit visit = (Visit) result.getModelAndView().getModel().get("visit");
		assertEquals(LocalDate.now().plusDays(1), visit.getDate());
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
	void rendersLocalizedDateErrors() throws Exception {
		String english = renderedDateError(Locale.ENGLISH);
		String german = renderedDateError(Locale.GERMAN);
		assertNotEquals(english, german, "The validation message must follow the selected language.");
	}

	private String renderedDateError(Locale locale) throws Exception {
		var result = mvc
			.perform(post("/owners/1/pets/1/visits/new").locale(locale)
				.sessionAttr(SessionLocaleResolver.LOCALE_SESSION_ATTRIBUTE_NAME, locale)
				.param("date", LocalDate.now().toString())
				.param("description", "Routine visit"))
			.andExpect(status().isOk())
			.andExpect(model().attributeHasFieldErrors("visit", "date"))
			.andReturn();
		BindingResult binding = (BindingResult) result.getModelAndView()
			.getModel()
			.get(BindingResult.MODEL_KEY_PREFIX + "visit");
		var error = binding.getFieldError("date");
		assertNotNull(error);
		String text = messages.getMessage(error, locale);
		assertFalse(text.isBlank(), "A visible validation message is required.");
		assertFalse(Arrays.asList(error.getCodes()).contains(text), "Unresolved message keys are not messages.");
		String html = result.getResponse().getContentAsString(StandardCharsets.UTF_8);
		assertTrue(html.contains(text) || html.contains(HtmlUtils.htmlEscape(text)),
				"The localized date error must be shown on the form.");
		return text;
	}

	@Test
	void keepsDescriptionRequired() throws Exception {
		mvc.perform(post("/owners/1/pets/1/visits/new").param("date", LocalDate.now().plusDays(1).toString())
			.param("description", "")).andExpect(model().attributeHasFieldErrors("visit", "description"));
	}

}
